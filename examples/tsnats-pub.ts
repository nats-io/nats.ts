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

import {connect, NatsConnectionOptions} from '../src/nats'
import {parseFlags} from "../test/helpers/argparser";

let flags = parseFlags(process.argv.slice(2), usage, ["count", "creds", "nkey"]);
let opts = {} as NatsConnectionOptions;
opts.url = flags.server;
if (flags.options.creds && flags.options.nkey) {
    console.error("specify one of -creds or -nkey");
    process.exit(-1);
}
if (flags.options.creds) {
    opts.userCreds = flags.options.creds;
}
if (flags.options.nkey) {
    opts.nkeyCreds = flags.options.nkey;
}

function usage() {
    console.log('tsnode-pub [-s <server>] [-count <count>] [-creds file] [-nkey file] <subject> [data]');
    process.exit(-1);
}

async function main() {
    let nc = await connect(opts);

    nc.on('permissionError', (err) => {
        console.log(`${err}`);
    });

    let max = flags.options["count"] || 1;
    for (let i = 0; i < max; i++) {
        nc.publish(flags.subject, flags.payload);
        console.log(`[#${i + 1}] published ${flags.subject} ${flags.payload || ""}`);
    }
    nc.flush(() => {
        nc.close();
    });
}

main();

