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
import * as url from 'url';
import { DEFAULT_PORT, DEFAULT_URI } from './const';
import { shuffle } from './util';
import { ServerInfo, ServersChangedEvent } from './nats';

/**
 * @hidden
 */
export class Server {
    url: url.Url;
    didConnect: boolean;
    reconnects: number;
    implicit: boolean;

    constructor(serverUrl: string, implicit = false) {
        // add scheme if not specified
        if (!/^.*:\/\/.*/.test(serverUrl)) {
            serverUrl = `nats://${serverUrl}`
        }

        this.url = url.parse(serverUrl);
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
            this.servers = urls.map((element) => new Server(element));

            if (randomize) {
                this.servers = shuffle(this.servers);
            }
        }

        if (firstServer) {
            const index = urls.indexOf(firstServer);

            if (index === -1) {
                this.addServer(firstServer, false);
            } else {
                const first = this.servers[index];

                this.servers.splice(index, 1);
                this.servers.unshift(first);
            }
        } else if (this.servers.length === 0) {
            this.addServer(DEFAULT_URI, false);
        }

        this.currentServer = this.servers[0];
    }

    getCurrentServer(): Server {
        return this.currentServer;
    }

    addServer(serverUrl: string, implicit = false) {
        this.servers.push(new Server(serverUrl, implicit));
    }

    selectServer(): Server | undefined {
        let nextServer = this.servers.shift();

        if (nextServer) {
            this.servers.push(nextServer);
            this.currentServer = nextServer;
        }

        return nextServer;
    }

    removeCurrentServer() {
        this.removeServer(this.currentServer);
    }

    removeServer(server: Server | undefined) {
        if (server) {
            const index = this.servers.indexOf(server);

            if (index > -1) {
                this.servers.splice(index, 1);
            }
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
        const added = [];
        let deleted: string[] = [];

        if (info.connect_urls && info.connect_urls.length > 0) {
            const discovered: { [key: string]: Server } = {};

            info.connect_urls.forEach(server => {
                // protocol in node includes the ':'
                const protocol = this.currentServer.url.protocol;
                const serverUrl = `${protocol}//${server}`;

                discovered[serverUrl] = new Server(serverUrl, true);
            });

            // remove implicit servers that are no longer reported
            const toDelete: number[] = [];
            this.servers.forEach((server, index) => {
                let serverUrl = server.toString();

                if (server.implicit && this.currentServer.url.href !== serverUrl && discovered[serverUrl] === undefined) {
                    // server was removed
                    toDelete.push(index);
                }

                // remove this entry from reported
                delete discovered[serverUrl];
            });

            // perform the deletion
            deleted = toDelete.reverse()
                .map((index) => {
                    const removed = this.servers.splice(index, 1);

                    return removed[0].url.toString();
                })

            // remaining servers are new
            for (let key in discovered) {
                if (discovered.hasOwnProperty(key)) {
                    this.servers.push(discovered[key]);
                    added.push(key);
                }
            }
        }
        return {added: added, deleted: deleted} as ServersChangedEvent;
    }
}