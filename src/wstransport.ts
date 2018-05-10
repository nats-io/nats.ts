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


import * as net from "net";
import {Transport, TransportHandlers} from "./transport";
import {UrlObject} from "url";

export class WSTransport implements Transport {
    stream: net.Socket | null = null;
    handlers: TransportHandlers;
    closed: boolean = false;

    constructor(handlers: TransportHandlers) {
        this.handlers = handlers;
    }

    private setupHandlers() : void {
        if(! this.stream) {
            return;
        }
        this.stream.on('connect', this.handlers.connect);
        this.stream.on('close', this.handlers.close);
        this.stream.on('error', this.handlers.error);
        this.stream.on('data', this.handlers.data);
    }

    connect(url: UrlObject) : void {
        // See #45 if we have a stream release the listeners
        // otherwise in addition to the leak events will fire fire
        if(this.stream) {
            this.destroy();
        }
        this.stream = WebSocket
        this.setupHandlers();
    }

    isClosed() : boolean {
        return this.closed;
    }

    isConnected() : boolean {
        return this.stream != null;
    }

    isEncrypted(): boolean {
        return false;
    }

    isAuthorized() : boolean {
        return false;
    }

    upgrade(tlsOptions: any, done: Function) : void {
    }

    write(data: Buffer|string): void {
        if(! this.stream) {
            return;
        }
        this.stream.write(data);
    }

    destroy() : void {
    }

    close() : void {
        this.closed = true;
        this.destroy();
    }

    pause() : void {
    }

    resume() : void {
    }
}