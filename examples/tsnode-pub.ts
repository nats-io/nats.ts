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

import {Client, connect} from '../src/nats'
import {parseFlags} from "../test/helpers/argparser";

let options = parseFlags(process.argv.slice(2), usage, ["count"]);

connect(options.server)
    .then((nc: Client) => {
        let max = options.options["count"] || 1;
        for(let i=0; i < max; i++) {
            nc.publish(options.subject, options.payload);
            console.log(`[#${i+1}]`, `Published`, options.subject, options.payload || "");
        }
        nc.flush(() => {
            nc.close();
        });
    })
    .catch((ex) => {
        console.log("error connecting to", options.server || "nats://localhost:4222", ": ", ex);
    });


function usage() {
    console.log('tsnode-pub [-s <server>] [-count <count>] subject [data]');
    process.exit(-1);
}

