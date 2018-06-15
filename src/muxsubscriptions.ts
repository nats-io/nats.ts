/*
 * Copyright 2018 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */


import {Client, SubscribeOptions} from "./nats";
import {RequestConfiguration} from "./types";
import nuid = require('nuid');


export class MuxSubscriptions {
    client: Client;
    inbox: string;
    inboxPrefixLen: number;
    subscriptionID: number;
    requestMap: { [key: string]: RequestConfiguration } = {};
    nextID: number = -1;

    constructor(client: Client) {
        this.client = client;
        this.inbox = client.createInbox();
        this.inboxPrefixLen = this.inbox.length + 1;
        let ginbox = this.inbox + ".*";
        this.subscriptionID = client.subscribe(ginbox, {} as SubscribeOptions, (msg: string | Buffer | object, reply: string, subject: string) => {
            let token = this.extractToken(subject);
            let conf = this.getMuxRequestConfig(token);
            if (conf) {
                if (conf.hasOwnProperty('expected')) {
                    conf.received++;
                    if (conf.expected !== undefined && conf.received >= conf.expected) {
                        this.cancelMuxRequest(token);
                    }
                }
                if (conf.callback) {
                    conf.callback(msg, reply);
                }
            }
        });
    }

    /**
     * Returns the mux request configuration
     * @param token
     * @returns Object
     */
    getMuxRequestConfig(token: string | number): RequestConfiguration {
        // if the token is a number, we have a fake sid, find the request
        if (typeof token === 'number') {
            let entry = null;
            for (let p in this.requestMap) {
                if (this.requestMap.hasOwnProperty(p)) {
                    let v = this.requestMap[p];
                    if (v.id === token) {
                        entry = v;
                        break;
                    }
                }
            }
            if (entry) {
                token = entry.token;
            }
        }
        return this.requestMap[token];
    }

    /**
     * Stores the request callback and other details
     *
     * @api private
     */
    initMuxRequestDetails(callback?: Function, expected?: number): RequestConfiguration {
        if (arguments.length === 1) {
            if (typeof callback === 'number') {
                expected = callback;
                callback = undefined;
            }
        }
        let token = nuid.next();
        let inbox = this.inbox + '.' + token;

        let conf = {
            token: token,
            callback: callback,
            inbox: inbox,
            id: this.nextID--,
            received: 0
        } as RequestConfiguration;
        if (expected !== undefined && expected > 0) {
            conf.expected = expected;
        }

        this.requestMap[token] = conf;
        return conf;
    };

    /**
     * Cancels the mux request
     *
     * @api private
     */
    cancelMuxRequest(token: string | number) {
        let conf = this.getMuxRequestConfig(token);
        if (conf) {
            if (conf.timeout) {
                clearTimeout(conf.timeout);
            }
            // the token could be sid, so use the one in the conf
            delete this.requestMap[conf.token];
        }
        return conf;
    };

    /**
     * Strips the prefix of the request reply to derive the token.
     * This is internal and only used by the new requestOne.
     *
     * @api private
     */
    extractToken(subject: string) {
        return subject.substr(this.inboxPrefixLen);
    }
}