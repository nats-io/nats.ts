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

import * as mockserver from './mock_server';

let port = 0;
if(process.argv.length > 2) {
    port = parseInt(process.argv[2], 10);
}

let server = new mockserver.ScriptedServer(port);
server.start().then((p) => {
    console.log('server running on port ', p);
}).catch((err) => {
    console.log('error starting mock server');
});
server.on('data', (s) => {
    console.log(s);
});

server.on('connection', (s) => {
    console.log('connected: ' + s.address());
});

server.on('close', () => {
    console.log('close');
});

server.on('error', () => {
    console.log('close');
});

server.on('listening', () => {
    console.log('listening');
});

server.on('warn', (m) => {
    console.log('warn', m);
});

server.on('info', (m) => {
    console.log('info', m);
});

server.on('debug', (m) => {
    console.log('debug', m);
});