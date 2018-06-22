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

import {test} from "ava";
import {connect, Msg, Payload} from "../src/nats";
import {Lock} from "./helpers/latch";
import {SC, startServer, stopServer} from "./helpers/nats_server_control";
import {next} from 'nuid';
import {NatsError} from "../src/error";


test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    //@ts-ignore
    stopServer(t.context.server);
});


test('connect no json propagates options', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats});
    //@ts-ignore
    t.is(nc.protocolHandler.payload, Payload.STRING, 'default payload');
    nc.close();
});

test('connect json propagates options', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: Payload.JSON});
    //@ts-ignore
    t.is(nc.protocolHandler.payload, Payload.JSON);
    nc.close();
});

async function macro(t: any, input: any): Promise<any> {
    t.plan(1);
    let lock = new Lock()
    try {
        let sc = t.context as SC;
        let nc = await connect({url: sc.server.nats, payload: Payload.JSON});
        let subj = next();
        nc.subscribe(subj, (err, msg) => {
            if(err) {
                t.fail(err);
            }
            // in JSON undefined is translated to null
            if (input === undefined) {
                input = null;
            }
            //@ts-ignore
            t.deepEqual(msg.data, input);
            // t.log([input, '===', msg.data]);
            lock.unlock();
        });

        nc.publish(subj, input);
    } catch (err) {
        t.fail(err);
        lock.unlock();
    }
    return lock.latch;
}

test('string', macro, 'helloworld');
test('empty', macro, '');
test('null', macro, null);
test('undefined', macro, undefined);
test('number', macro, 10);
test('false', macro, false);
test('true', macro, true);
test('empty array', macro, []);
test('any array', macro, [1, 'a', false, 3.1416]);
test('empty object', macro, {});
test('object', macro, {a: 1, b: false, c: 'name', d: 3.1416});
