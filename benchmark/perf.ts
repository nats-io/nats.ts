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
import {parseFlags} from "../test/helpers/argparser";
import {randomBytes} from 'crypto';
import {log} from "../test/helpers/perflog";


let args = process.argv.slice(3);
// push the default subject
args.push('test');

let pargs = parseFlags(args , usage, ["count", "size", "nosave"]);
let count = pargs.options["count"] || 1000000;
let loop = parseInt(count.toString(), 10);
let hash = parseInt((loop / 80).toString(), 10);
let size = pargs.options["size"] || 2;
size = parseInt(size.toString(), 10);
let payload = randomBytes(size);
pargs.payload = payload;


let test = process.argv[2];
let testFn : Function;
switch(test) {
    case "pub":
        testFn = pubTest;
        break;
    case "sub":
        testFn = subTest;
        break;
    case "pubsub":
        testFn = pubsubTest;
        break;
    case "reqrep":
        testFn = reqrepTest;
        loop = 100000;
        break;
    default:
        usage();
}

let nc : Client;

start()
    .catch((ex) => {
        console.log("error running test", pargs.server || "nats://localhost:4222", ": ", ex);
        process.exit(1);
    });

async function start() {
    nc = await connect({url: pargs.server, payload: Payload.BINARY});
    nc.on('connect', () => {
        testFn();
    })
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
    });

    nc.on('unsubscribe', () => {
        let millis = Date.now() - start;
        let mps = Math.round((loop / (millis / 1000)));
        console.log('\nReceived at ' + mps + ' msgs/sec');
        log("sub.csv", "sub", loop, millis);
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
    if(pargs.options.nosave === undefined) {
        log("pub.csv", "pub", loop, millis);
    } else {
        process.exit();
    }
}

async function pubsubTest() {
    let nc2 = await connect({url: pargs.server, payload: Payload.BINARY});
    let start = Date.now();
    let i = 0;
    let sub = await nc2.subscribe(pargs.subject, (err, msg) => {
        i++;
        if(i % hash === 0) {
            process.stdout.write('=');
        }
    }, {max: loop});

    nc2.on('unsubscribe', () => {
        let millis = Date.now() - start;
        let mps = Math.round((loop / (millis / 1000)));
        console.log('\npubsub at',mps, 'msgs/sec', '[', loop, "msgs", ']');
        log("pubsub.csv", "pubsub", loop, millis);
        nc.close();
        nc2.close();
    });
    nc2.flush(() => {
        for(let i=0; i < count; i++) {
            nc.publish(pargs.subject, payload);
        }
    });
}

async function reqrepTest() {
    let nc2 = await connect({url: pargs.server, payload: Payload.BINARY});
    let r = 0;
    let sub = await nc2.subscribe('request.test', (err, msg) => {
        if(msg.reply) {
            r++;
            nc2.publish(msg.reply, 'ok');
            if(r % hash === 0) {
                process.stdout.write('=');
            }
        }
    }, {max: loop, queue: 'A'});

    await nc2.flush();

    let start = Date.now();
    let promises = [];

    for(let i=0; i < loop; i++) {
        promises.push(nc.request('request.test', 60000));
    }
    Promise.all(promises)
        .then(() => {
            let millis = Date.now() - start;
            let rps = Math.round((loop / (millis / 1000)));
            console.log('\n' + rps + ' request-responses/sec');

            let lat = Math.round((millis * 1000) / (loop * 2)); // Request=2, Reponse=2 RTs
            console.log('Avg roundtrip latency', lat, 'microseconds');
            log("rr.csv", "rr", loop, millis);
            nc2.close();
            nc.close();
        })
        .catch((ex) => {
            console.log('error during reqreply test', ex);
            process.exit(-1);
        });

}

function usage() {
    console.log('tsnode_perf <pub|sub|pubsub|reqrep> [-s <server>] [-count <count>]');
    process.exit(-1);
}