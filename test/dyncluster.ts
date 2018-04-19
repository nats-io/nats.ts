/*
 * Copyright 2013-2018 The NATS Authors
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
 */

import * as NATS from '../src/nats';
import {NatsConnectionOptions} from '../src/nats';
import * as nsc from './support/nats_server_control';
import {Server} from './support/nats_server_control';
import {expect} from 'chai';


describe('Dynamic Cluster - Connect URLs', () => {
    // this to enable per test cleanup
    let servers: Server[];
    // Shutdown our servers
    afterEach((done) => {
        nsc.stop_cluster(servers, () => {
            servers = [];
            done();
        });
    });

    it('adding cluster performs update', (done) => {
        let route_port = 25220;
        let port = 25221;

        // start a new cluster with single server
        servers = nsc.start_cluster([port], route_port, [], () => {
            expect(servers).to.have.lengthOf(1);

            // connect the client
            let nc = NATS.connect({
                url: `nats://127.0.0.1:${port}`,
                reconnectTimeWait: 100
            } as NatsConnectionOptions);
            nc.on('connect', () => {
                // start adding servers
                process.nextTick(() => {
                    let others = nsc.add_member_with_delay([port + 1, port + 2], route_port, 250, [], () => {
                        // verify that 2 servers were added
                        expect(others).to.have.lengthOf(2);
                        others.forEach(function(o) {
                            // add them so they can be reaped
                            servers.push(o);
                        });
                        // give some time for the server to send infos
                        setTimeout(() => {
                            // we should know of 3 servers - the one we connected and the 2 we added
                            //@ts-ignore
                            expect(nc.servers.servers).to.have.lengthOf(3);
                            nc.close();
                            done();
                        }, 1000);
                    });
                });
            });
        });
    }).timeout(10000);

    it('servers are shuffled', (done) => {
        let route_port = 54320;
        let port = 54321;
        // start a cluster of one server
        let ports: number[] = [];
        for (let i = 0; i < 10; i++) {
            ports.push(port + i);
        }
        servers = nsc.start_cluster(ports, route_port, [], () => {
            expect(servers).to.have.lengthOf(10);

            // added in order
            let uris: string[] = [];
            ports.forEach(function(p) {
                uris.push(`nats://127.0.0.1:${p}`);
            });

            let nc = NATS.connect({
                reconnectTimeWait: 100,
                servers: uris
            } as NatsConnectionOptions);
            nc.on('connect', () => {
                let found: string[] = [];
                //@ts-ignore
                nc.servers.getServers().forEach(function (s) {
                    //@ts-ignore
                    found.push(parseInt(s.url.port, 10));
                });
                expect(found.length).to.be.equal(ports.length);
                ports.forEach((port) => {
                    expect(found).to.contain(port);
                });
                nc.close();
                done();
            });
        });
    }).timeout(10000);

    it('added servers not shuffled when noRandomize is set', (done) => {
        let route_port = 54320;
        let port = 54321;
        // start a cluster of one server
        let ports: number[] = [];
        for (let i = 0; i < 10; i++) {
            ports.push(port + i);
        }
        let map: { [key: string]: number } = {};
        servers = nsc.start_cluster(ports, route_port, [], () => {
            expect(servers).to.have.lengthOf(10);

            let connectCount = 0;

            function connectAndRecordPorts(check: Function) {
                let nc = NATS.connect({
                    'port': port,
                    'reconnectTimeWait': 100,
                    'noRandomize': true
                } as NatsConnectionOptions);
                nc.on('connect', () => {
                    let have: string[] = [];
                    //@ts-ignore
                    nc.servers.getServers().forEach(function(s) {
                        //@ts-ignore
                        have.push(parseInt(s.url.port, 10));
                    });

                    connectCount++;
                    expect(have[0]).to.be.equal(port);
                    let key = have.join("_");
                    map[key] = map[key] ? map[key] + 1 : 1;
                    nc.close();
                    if (connectCount === 10) {
                        check();
                    }
                });
            }

            // we should have more than one property if there was randomization
            function check() {
                let keys = Object.getOwnPropertyNames(map);
                expect(keys).to.have.lengthOf(1);
                expect(map[keys[0]]).to.be.equal(10);
                done();
            }

            // connect several times...
            for (let i = 0; i < 10; i++) {
                connectAndRecordPorts(check);
            }
        });
    }).timeout(10000);


    it('joins url and servers', (done) => {
        let route_port = 54320;
        let port = 54321;
        // start a cluster of one server
        let ports = [];
        for (let i = 0; i < 10; i++) {
            ports.push(port + i);
        }

        // Add 5 of the servers we know. One added in the 'uri'
        let urls: string[] = [];
        for (let i = 1; i < 4; i++) {
            urls.push("nats://127.0.0.1:" + (port + i));
        }
        servers = nsc.start_cluster(ports, route_port, [], () => {
            let nc = NATS.connect({
                url: "nats://127.0.0.1:" + port,
                reconnectTimeWait: 100,
                servers: urls
            } as NatsConnectionOptions);

            nc.on('connect', function (c) {
                expect(c.servers.getServers()).to.have.lengthOf(10);
                c.close();
                done();
            });
        });
    }).timeout(10000);

    it('discovered servers', (done) => {
        let route_port = 12892;
        let port = 14526;
        let ports = [port, port + 1, port + 2];

        servers = nsc.start_cluster(ports, route_port, [], () => {
            let nc = NATS.connect({
                url: "nats://127.0.0.1:" + port,
                reconnectTimeWait: 100,
                servers: ["nats://127.0.0.1:" + (port + 1)]
            } as NatsConnectionOptions);

            function countImplicit(c: NATS.Client) {
                let count = 0;
                //@ts-ignore
                c.servers.getServers().forEach(function (s) {
                    if (s.implicit) {
                        count++;
                    }
                });
                return count;
            }

            nc.on('serversDiscovered', () => {
                if (countImplicit(nc) === 1) {
                    //@ts-ignore
                    let found = nc.servers.getServers().find(function (s) {
                        return s.url.href === "nats://127.0.0.1:" + (port + 3);
                    });
                    if (found) {
                        done();
                    }
                }
            });

            nc.on('connect', () => {
                if (!testVersion("1.0.7", nc)) {
                    nc.close();
                    done();
                }
                //@ts-ignore
                expect(nc.servers.getServers()).to.have.lengthOf(3);
                expect(countImplicit(nc)).to.be.equal(1);

                // remove the implicit one
                process.nextTick(() => {
                    let s2 = nsc.find_server(port + 2, servers);
                    if (s2) {
                        nsc.stop_server(s2,  () => {
                            // add another
                            let added = nsc.add_member(port + 3, route_port, port + 1003);
                            servers.push(added);
                        });
                    } else {
                        done(new Error('server at port ' + (port + 2) + ' was not found'));
                    }
                });
            });
        });
    });
});


function parseVersion(verstr: string): number {
    // this will break
    let a = verstr.split(".");
    if (a.length > 3) {
        a.splice(3, a.length - 3);
    }

    let n: number[] = [];
    a.forEach((s, index) => {
        n[index] = parseInt(s, 10);
    });
    n[0] *= 100;
    n[1] *= 10;

    return n[0] + n[1] + n[2];
}

function testVersion(required: string, nc: NATS.Client) {
    //@ts-ignore
    let vers = parseVersion(nc.info.version);
    let req = parseVersion(required);

    return vers >= req;
}


