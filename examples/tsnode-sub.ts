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

import {Client, connect, SubscriptionOptions} from '../src/nats'
import {parseFlags} from "../test/helpers/argparser";

let options = parseFlags(process.argv.slice(2), usage, ["max"]);

connect(options.server)
    .then((nc: Client) => {
        // this client only has a single subscription
        // if the subscription finishes, close() so the client exits.
        nc.on('unsubscribe', () => {
            nc.close();
        });

        // if user specifies a max, auto-unsubscribe when the count is reached
        let max = options.options["max"] || -1;
        max = parseInt(max.toString(), 10);
        let subopts = {} as SubscriptionOptions;
        if(max > 0) {
            subopts.max = max;
        }

        // create the subscription
        let count = 0;
        nc.subscribe(options.subject, (err, msg) => {
            count++;
            console.log(`[#${count}]`, 'Received on', `[${msg.subject}]`, msg.data);
        }, subopts)
            .then((sub) => {
                // print a message when the subscription is processed by the server
                nc.flush(() => {
                    console.log('Listening to', `[${options.subject}]`);
                });
            })
            .catch((err) => {
                console.log('Error subscribing to', `[${options.subject}]`, err);
            });
    })
    .catch((ex) => {
        console.log("error connecting to", options.server || "nats://localhost:4222", ": ", ex);
    });


function usage() {
    console.log('tsnode-sub [-s <server>] [-max count] subject');
    process.exit(-1);
}
