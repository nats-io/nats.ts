#!/usr/bin/env ts-node

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
import * as NATS from '../../src/nats';
import * as fs from 'fs';
import {NatsConnectionOptions} from "../../src/nats";

let count = process.argv.length;
let port = parseInt(process.argv[count - 1], 10);
let nc = NATS.connect({port: port} as NatsConnectionOptions);


nc.on('connect', function () {
    fs.writeFile('/tmp/existing_client.log', 'connected\n', (err) => {
        if (err) {
            console.error(err);
        }
    });
});


nc.on('error', function (e) {
    fs.appendFile('/tmp/existing_client.log', 'got error\n' + e, (err) => {
        if (err) {
            console.error(err);
        }
    });
    process.exit(1);
});

nc.subscribe("close", {} as NATS.SubscribeOptions, (msg, inbox) => {
    fs.appendFile('/tmp/existing_client.log', 'got close\n', (err) => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
    });
    if (inbox) {
        nc.publish(inbox, "closing");
    }
    nc.flush(function () {
        nc.close();
        fs.appendFile('/tmp/existing_client.log', 'closed\n', (err) => {
            if (err) {
                console.error(err);
                process.exit(1);
            }
        });
        process.exit(0);
    });
});

nc.flush(function () {
    nc.publish("started", "");
});
