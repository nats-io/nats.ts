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

 // Connection defaults
export const DEFAULT_PORT = 4222;
export const DEFAULT_PRE = 'nats://localhost:';
export const DEFAULT_URI = DEFAULT_PRE + DEFAULT_PORT;

// Reconnect Parameters, 2 sec wait, 10 tries
export const DEFAULT_RECONNECT_TIME_WAIT = 2 * 1000;
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

// Ping interval
export const DEFAULT_PING_INTERVAL = 2 * 60 * 1000; // 2 minutes
export const DEFAULT_MAX_PING_OUT = 2;

// Line handling
export const CR_LF = '\r\n';
export const CR_LF_LEN = CR_LF.length;
export const EMPTY = '';