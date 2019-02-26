/*
 * Copyright 2018-2019 The NATS Authors
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
import * as url from 'url';
import {DEFAULT_PORT, DEFAULT_URI} from './const';
import {shuffle} from './util';
import {ServerInfo, ServersChangedEvent} from './nats';

/**
 * @hidden
 */
export class Server {
    url: url.Url;
    didConnect: boolean;
    reconnects: number;
    implicit: boolean;

    constructor(u: string, implicit = false) {
        // add scheme if not specified
        if (!/^.*:\/\/.*/.test(u)) {
            u = `nats://${u}`
        }

        this.url = url.parse(u);
        if (!this.url.port) {
            this.url.port = `${DEFAULT_PORT}`;
        }
        this.didConnect = false;
        this.reconnects = 0;
        this.implicit = implicit;
    }

    toString(): string {
        return this.url.href || '';
    }

    getCredentials(): string[] | undefined {
        if ('auth' in this.url && !!this.url.auth) {
            return this.url.auth.split(':');
        }
        return undefined;
    }
}

/**
 * @hidden
 */
export class Servers {
    private readonly servers: Server[];
    private currentServer: Server;

    constructor(randomize: boolean, urls: string[], firstServer?: string) {
        this.servers = [] as Server[];
        if (urls) {
            urls.forEach(element => {
                this.servers.push(new Server(element));
            });
            if (randomize) {
                this.servers = shuffle(this.servers);
            }
        }

        if (firstServer) {
            let index = urls.indexOf(firstServer);
            if (index === -1) {
                this.addServer(firstServer, false);
            } else {
                let fs = this.servers[index];
                this.servers.splice(index, 1);
                this.servers.unshift(fs);
            }
        } else {
            if (this.servers.length === 0) {
                this.addServer(DEFAULT_URI, false);
            }
        }
        this.currentServer = this.servers[0];
    }

    getCurrentServer(): Server {
        return this.currentServer;
    }

    addServer(u: string, implicit = false): void {
        this.servers.push(new Server(u, implicit));
    }

    selectServer(): Server | undefined {
        let t = this.servers.shift();
        if (t) {
            this.servers.push(t);
            this.currentServer = t;
        }
        return t;
    }

    removeCurrentServer(): void {
        this.removeServer(this.currentServer);
    }

    removeServer(server: Server | undefined): void {
        if (server) {
            let index = this.servers.indexOf(server);
            this.servers.splice(index, 1);
        }
    }

    length(): number {
        return this.servers.length;
    }

    next(): Server | undefined {
        return this.servers.length ? this.servers[0] : undefined;
    }

    getServers(): Server[] {
        return this.servers;
    }

    processServerUpdate(info: ServerInfo): ServersChangedEvent {
        let added = [];
        let deleted: string[] = [];

        if (info.connect_urls && info.connect_urls.length > 0) {
            let discovered: { [key: string]: Server } = {};

            info.connect_urls.forEach(server => {
                // protocol in node includes the ':'
                let protocol = this.currentServer.url.protocol;
                let u = `${protocol}//${server}`;
                discovered[u] = new Server(u, true);
            });

            // remove implicit servers that are no longer reported
            let toDelete: number[] = [];
            this.servers.forEach((s, index) => {
                let u = s.toString();
                if (s.implicit && this.currentServer.url.href !== u && discovered[u] === undefined) {
                    // server was removed
                    toDelete.push(index);
                }
                // remove this entry from reported
                delete discovered[u];
            });

            // perform the deletion
            toDelete.reverse();
            toDelete.forEach(index => {
                let removed = this.servers.splice(index, 1);
                deleted = deleted.concat(removed[0].url.toString());
            });

            // remaining servers are new
            for (let k in discovered) {
                if (discovered.hasOwnProperty(k)) {
                    this.servers.push(discovered[k]);
                    added.push(k);
                }
            }
        }
        return {added: added, deleted: deleted} as ServersChangedEvent;
    }
}