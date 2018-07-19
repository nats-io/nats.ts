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

import test from "ava";
import {SC, startServer, stopServer} from "./helpers/nats_server_control";
import * as child_process from "child_process";
import url from 'url';
import {connect} from "../src/nats";
import {Lock} from "./helpers/latch";

test.before(async (t) => {
    let server = await startServer();
    // let server = await startServer("", ['--', '-p', '4222']);
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
});


test('close quickly', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;
    let u = new url.URL(sc.server.nats);
    let port = u.port;

    let nc = await connect({url: sc.server.nats, name: "closer"});

    let sub = nc.subscribe("started", (err, msg) => {
        nc.publish("close");
    });

    let timer = setTimeout(() => {
        t.fail("process didn't exit quickly");
        lock.unlock();
    }, 10000);

    let child = child_process.execFile(process.argv[0], [__dirname + '/helpers/exiting_client.js', port], (error) => {
        if (error) {
            nc.close();
            t.fail(error.message);
            lock.unlock();
        }
    });

    child.on('error', (err) => {
        t.log(err);
    });

    child.on('exit', (code, signal) => {
        if (timer) {
            clearTimeout(timer);
        }
        nc.close();
        if (code !== 0) {
            t.fail(`Process didn't return a zero code: ${code} signal: ${signal}`);
        } else {
            t.pass();
        }
        lock.unlock();
    });

    return lock.latch;
});



