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

import test from 'ava';
import {connect, ErrorCode, NatsConnectionOptions, Payload} from '../src/nats';
import {Lock} from './helpers/latch';
import {SC, startServer, stopServer} from './helpers/nats_server_control';
import {next} from 'nuid';
import {createInbox} from "../src/util";


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

test('pubsub should fail circular json', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let o = {};
    //@ts-ignore
    o.a = o;
    let nc = await connect({url: sc.server.nats, payload: Payload.JSON});
    t.throws(() => {
        nc.publish(next(), o);
    }, {code: ErrorCode.BAD_JSON});
    nc.close();
});

test('reqrep should fail circular json', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let o = {};
    //@ts-ignore
    o.a = o;
    let nc = await connect({url: sc.server.nats, payload: Payload.JSON});
    await t.throwsAsync(nc.request(next(), 1000, o), {code: ErrorCode.BAD_JSON});
    nc.close();
});

async function pubsub(t: any, input: any): Promise<any> {
    t.plan(1);
    let lock = new Lock();
    try {
        let sc = t.context as SC;
        let nc = await connect({url: sc.server.nats, payload: Payload.JSON});
        let subj = next();
        nc.subscribe(subj, (err, msg) => {
            if (err) {
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

async function reqrep(t: any, input: any): Promise<any> {
    t.plan(1);
    let lock = new Lock();
    try {
        let sc = t.context as SC;
        let nc = await connect({url: sc.server.nats, payload: Payload.JSON});
        let subj = next();
        nc.subscribe(subj, (err, msg) => {
            if (msg.reply) {
                nc.publish(msg.reply, msg.data);
            }
        });

        let msg = await nc.request(subj, 500, input);
        // in JSON undefined is translated to null
        if (input === undefined) {
            input = null;
        }
        //@ts-ignore
        t.deepEqual(msg.data, input);
        lock.unlock();
    } catch (err) {
        t.fail(err);
        lock.unlock();
    }
    return lock.latch;
}

const complex = {
    json: {
        field: 'hello',
        body: 'world'
    },
    empty_array: [],
    array: [1, -2.3, 'foo', false],
    true: true,
    false: false,
    null: null,
    number: -123.45,
    empty_string: '',
    string: 'abc'
};


test('subscribe subject should be in subject ', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: Payload.STRING} as NatsConnectionOptions);
    let jnc = await connect({url: sc.server.nats, payload: Payload.JSON} as NatsConnectionOptions);
    let prefix = createInbox();
    let subj = `${prefix}.*`;
    await jnc.subscribe(subj, (err, msg) => {
        t.truthy(err);
        t.is(msg.subject, `${prefix}.foo`);
    });
    await jnc.flush();
    nc.publish(`${prefix}.foo`);
    await nc.flush();
    await jnc.flush();
    jnc.close();
    nc.close();
});

test('string', pubsub, 'helloworld');
test('empty', pubsub, '');
test('null', pubsub, null);
test('undefined', pubsub, undefined);
test('number', pubsub, 10);
test('false', pubsub, false);
test('true', pubsub, true);
test('empty array', pubsub, []);
test('any array', pubsub, [1, 'a', false, 3.1416]);
test('empty object', pubsub, {});
test('object', pubsub, {a: 1, b: false, c: 'name', d: 3.1416});
test('complex', pubsub, complex);

test('rr string', reqrep, 'helloworld');
test('rr empty', reqrep, '');
test('rr null', reqrep, null);
test('rr undefined', reqrep, undefined);
test('rr number', reqrep, 10);
test('rr false', reqrep, false);
test('rr true', reqrep, true);
test('rr empty array', reqrep, []);
test('rr any array', reqrep, [1, 'a', false, 3.1416]);
test('rr empty object', reqrep, {});
test('rr object', reqrep, {a: 1, b: false, c: 'name', d: 3.1416});
test('rr complex', reqrep, complex);
