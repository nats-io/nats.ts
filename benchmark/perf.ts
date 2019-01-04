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

import {Client, connect, Payload} from '../src/nats'
import {parseFlags} from '../test/helpers/argparser';
import {randomBytes} from 'crypto';
import {log} from '../test/helpers/perflog';
import {ChildProcess, spawn} from 'child_process';
import {Server, startServer, stopServer} from '../test/helpers/nats_server_control';
import {appendFileSync, mkdtemp} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {promisify} from 'util';


let args = process.argv.slice(3);
// push the default subject
args.push('test');


let pargs = parseFlags(args , usage, ['count', 'size', 'tag']);
let tag = pargs.options['tag'] || "";
let count = pargs.options['count'] || 1000000;
let loop = parseInt(count.toString(), 10);
let hash = parseInt((loop / 80).toString(), 10);
let size = pargs.options['size'] || 2;
size = parseInt(size.toString(), 10);
let payload = randomBytes(size);
pargs.payload = payload;


let test = process.argv[2];
let testFn : Function;
switch(test) {
    case 'pub':
        testFn = pubTest;
        break;
    case 'sub':
        testFn = subTest;
        break;
    case 'pubsub':
        testFn = pubsubTest;
        break;
    case 'reqrep':
        testFn = reqrepTest;
        break;
    default:
        usage();
}

let nc : Client;
let server: Server;


start()
    .catch((ex) => {
        console.log("error running test", pargs.server, ": ", ex);
        process.exit(1);
    });

async function start() {
    if(! pargs.server) {
        // create a config file - reqrep needs to have a write_dealine for large volume
        let mktmp = promisify(mkdtemp);
        let dir = await mktmp(join(tmpdir(), "nats"));
        let conf = join(dir, "nats.conf");
        appendFileSync(conf, "write_deadline: \"1000s\"\n");
        server = await startServer(['-c', conf]);
        pargs.server = server.nats;
    }
    nc = await connect({url: pargs.server, payload: Payload.BINARY});
    nc.on('connect', () => {
        testFn();
    });
    nc.on('close', () => {
        if(server) {
            stopServer(server as Server);
        }
    });
}

async function subTest() {
    let i = 0;
    let start = 0;
    let sub = await nc.subscribe(pargs.subject, (err, msg) => {
        i++;
        if(i === 1) {
            start = Date.now();
        }
        if(i % hash === 0) {
            process.stdout.write('=');
        }
    }, {max: loop});
    nc.flush(() => {
        console.log('Waiting for', loop, 'messages');
        try {
            let process = spawn('nats-bench', ['-s', pargs.server || "", '-n', count.toString(), '-ns', '0', '-np', '1', "-ms", size.toString(), "test"]);
            process.stderr.on('data', (data) => {
                let lines = data.toString().split('\n');
                lines.forEach((m) => {
                    console.log(m);
                });
            });
            process.stdout.on('data', (data) => {
                let lines = data.toString().split('\n');
                lines.forEach((m) => {
                    console.log(m);
                });
            });
        } catch(ex) {
            console.log(ex);
        }
    });

    nc.on('unsubscribe', () => {
        let millis = Date.now() - start;
        let mps = Math.round((loop / (millis / 1000)));
        console.log('\nReceived at ' + mps + ' msgs/sec');
        log('metrics.csv', 'sub', loop, millis, tag);
        nc.close();
    });
}

async function pubTest() {
    let start = Date.now();
    for(let i=0; i < count; i++) {
        nc.publish(pargs.subject, payload);
        if(i % hash === 0) {
            process.stdout.write('=');
        }
    }
    await nc.flush();
    let millis = Date.now() - start;
    let mps = Math.round((loop / (millis / 1000)));
    console.log('\nPublished at ' + mps + ' msgs/sec');
    log('metrics.csv', 'pub', loop, millis, tag);
    nc.close();
}

async function pubsubTest() {
    let nc1 = await connect({url: pargs.server, payload: Payload.STRING});
    let received = 0;
    let sub = await nc1.subscribe(pargs.subject, (err, msg) => {
        received++;
        if(received === loop) {
            let millis = Date.now() - start;
            let mps = Math.round((loop / (millis / 1000)));
            console.log('\npubsub at', mps, 'msgs/sec', '[', loop, "msgs", ']');
            log('metrics.csv', 'pubsub', loop, millis, tag);
            nc1.close();
            nc.close();
        }
    }, {max: loop});


    await nc1.flush();
    await nc.flush();

    let start = Date.now();
    for(let i=0; i < loop; i++) {
        nc.publish(pargs.subject, payload);
        if(i % hash === 0) {
            process.stdout.write('=');
        }
    }
}

async function reqrepTest() {
    let nc2 = await connect({url: pargs.server, payload: Payload.BINARY});
    let r = 0;
    let sub = await nc2.subscribe('request.test', (err, msg) => {
        if(msg.reply) {
            r++;
            nc2.publish(msg.reply, 'ok');
        }
    }, {max: loop});

    await nc2.flush();

    let received = 0;
    let start = Date.now();
    for(let i=1; i <= loop; i++) {
        nc.request('request.test', 60000, payload)
            .then((m) => {
                received++;
                if(received % hash === 0) {
                    process.stdout.write('=');
                }
                if(received === loop) {
                    let millis = Date.now() - start;
                    let rps = Math.round((loop / (millis / 1000)));
                    console.log('\n' + rps + ' request-responses/sec');

                    let lat = Math.round((millis * 1000) / (loop * 2)); // Request=2, Reponse=2 RTs
                    console.log('Avg round-trip latency', lat, 'microseconds');
                    log('metrics.csv', 'reqrep', loop, millis, tag);
                    nc2.close();
                    nc.close();
                }
            });
    }
}

function usage() {
    console.log('tsnode_perf <pub|sub|pubsub|reqrep> [-s <server>] [-count <count>] [-tag <tag>]');
    process.exit(-1);
}