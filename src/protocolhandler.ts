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

import {
    Client,
    defaultSub,
    FlushCallback,
    NatsConnectionOptions,
    Payload,
    Req,
    ServerInfo,
    Sub,
    SubEvent,
    Subscription,
    VERSION
} from './nats';
import {MuxSubscriptions} from './muxsubscriptions';
import {Callback, Transport, TransportHandlers} from './transport';
import {CONN_ERR_PREFIX, ErrorCode, NatsError} from './error';

import {EventEmitter} from 'events';
import {CR_LF, DEFAULT_PING_INTERVAL, EMPTY} from './const';
import {Server, Servers} from './servers';
import {TCPTransport} from './tcptransport';
import {Subscriptions} from './subscriptions';
import {DataBuffer} from './databuffer';
import {MsgBuffer} from './messagebuffer';
import {settle} from './util';
import * as fs from 'fs';
import * as url from 'url';
import * as nkeys from 'ts-nkeys';
import Timer = NodeJS.Timer;

const PERMISSIONS_ERR = 'permissions violation';
const STALE_CONNECTION_ERR = 'stale connection';

// Protocol
const MSG = /^MSG\s+([^\s\r\n]+)\s+([^\s\r\n]+)\s+(([^\s\r\n]+)[^\S\r\n]+)?(\d+)\r\n/i,
    OK = /^\+OK\s*\r\n/i,
    ERR = /^-ERR\s+('.+')?\r\n/i,
    PING = /^PING\r\n/i,
    PONG = /^PONG\r\n/i,
    INFO = /^INFO\s+([^\r\n]+)\r\n/i,
    SUBRE = /^SUB\s+([^\r\n]+)\r\n/i,
    CREDS = /\s*(?:(?:[-]{3,}[^\n]*[-]{3,}\n)(.+)(?:\n\s*[-]{3,}[^\n]*[-]{3,}\n))/i,

    // Protocol
    SUB = 'SUB',
    CONNECT = 'CONNECT',

    FLUSH_THRESHOLD = 65536;

const CRLF_BUF = Buffer.from('\r\n');

// Parser state
enum ParserState {
    CLOSED = -1,
    AWAITING_CONTROL = 0,
    AWAITING_MSG_PAYLOAD = 1
}

enum TlsRequirement {
    OFF = -1,
    ANY = 0,
    ON = 1
}

/**
 * @hidden
 */
export class ProtocolHandler extends EventEmitter {
    options: NatsConnectionOptions;
    subscriptions: Subscriptions;
    muxSubscriptions = new MuxSubscriptions();
    private client: Client;
    private closed: boolean = false;
    private connected: boolean = false;
    private currentServer!: Server;
    private encoding: BufferEncoding;
    private inbound = new DataBuffer();
    private info: ServerInfo = {} as ServerInfo;
    private infoReceived: boolean = false;
    private msgBuffer?: MsgBuffer | null;
    private outbound = new DataBuffer();
    private payload: Payload;
    private pingTimer?: Timer;
    private pongs: any[] = [];
    private pout: number = 0;
    private reconnecting: boolean = false;
    private reconnects: number = 0;
    private servers: Servers;
    private ssid: number = 1;
    private state: ParserState = ParserState.AWAITING_CONTROL;
    private transport: Transport;
    private url!: url.UrlObject;
    private wasConnected: boolean = false;
    private draining: boolean = false;
    private noMorePublishing: boolean = false;

    constructor(client: Client, options: NatsConnectionOptions) {
        super();
        EventEmitter.call(this);

        this.client = client;
        this.options = options;
        this.encoding = options.encoding || 'utf8';
        this.payload = options.payload || Payload.STRING;

        this.subscriptions = new Subscriptions();
        this.subscriptions.on('subscribe', (sub) => {
            this.client.emit('subscribe', sub);
        });
        this.subscriptions.on('unsubscribe', (unsub) => {
           this.client.emit('unsubscribe', unsub);
        });
        this.servers = new Servers(!this.options.noRandomize, this.options.servers || [], this.options.url);
        this.transport = new TCPTransport(this.getTransportHandlers());
    }

    static connect(client: Client, opts: NatsConnectionOptions): Promise<ProtocolHandler> {
        return new Promise<ProtocolHandler>(async (resolve, reject) => {
            let expired = false;
            let to: NodeJS.Timeout;
            let millis: number = 0;
            if(opts.timeout && !isNaN(opts.timeout)) {
                millis = opts.timeout;
            }
            if(millis > 0) {
                to = setTimeout(() => {
                    expired = true;
                }, millis);
            }


            let ph = new ProtocolHandler(client, opts);
            // the initial connection handles the reconnect logic
            // for all the servers. This way we can return at least
            // one error to the user. Once connected (wasConnected is set),
            // the event handlers will take over
            let lastError: Error | null = null;
            let fn = function(n: number) {
                if(expired) {
                    reject(NatsError.errorForCode(ErrorCode.CONN_TIMEOUT));
                    return
                }
                if (n <= 0) {
                    if (!ph.options.waitOnFirstConnect) {
                        reject(lastError);
                        return;
                    }
                }
                ph.connect()
                    .then(() => {
                        if(to) {
                            clearTimeout(to);
                        }
                        resolve(ph);
                    })
                    .catch((ex) => {
                        // FIXME: cannot honor a delay
                        lastError = ex;
                        setTimeout(() => {
                            fn(n-1);
                        }, ph.options.reconnectTimeWait || 0)
                    });
            };
            fn(ph.servers.length());
        });
    }

    flush(cb: FlushCallback): void {
        if (this.closed) {
            if (typeof cb === 'function') {
                cb(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
                return;
            } else {
                throw NatsError.errorForCode(ErrorCode.CONN_CLOSED);
            }
        }
        this.pongs.push(cb);
        this.sendCommand(this.buildProtocolMessage('PING'));
    }

    close(): void {
        if (this.pingTimer) {
            clearTimeout(this.pingTimer);
            delete this.pingTimer;
        }
        this.closed = true;
        this.removeAllListeners();
        this.closeStream();
        this.ssid = -1;
        this.subscriptions.close();
        this.muxSubscriptions.close();
        this.state = ParserState.CLOSED;
        this.pongs = [];
        this.outbound.reset();
    };

    drain(): Promise<any> {
        if (this.closed) {
            return Promise.reject(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
        }
        if (this.draining) {
            return Promise.reject(NatsError.errorForCode(ErrorCode.CONN_DRAINING));
        }
        this.draining = true;

        let subs = this.subscriptions.all();
        let promises: Promise<SubEvent>[] = [];
        subs.forEach((sub) => {
            let p = this.drainSubscription(sub.sid);
            promises.push(p);
        });
        return new Promise((resolve) => {
            settle(promises)
                .then((a) => {
                    this.noMorePublishing = true;
                    process.nextTick(() => {
                        // send pending buffer
                        this.flush(() => {
                            this.close();
                            resolve(a);
                        });
                    });
                })
                .catch(() => {
                    // cannot happen
                });
        });
    }

    publish(subject: string, data: any, reply: string = ''): void {
        if (this.closed) {
            throw NatsError.errorForCode(ErrorCode.CONN_CLOSED);
        }
        if (this.noMorePublishing) {
            throw NatsError.errorForCode(ErrorCode.CONN_DRAINING);
        }
        data = this.toBuffer(data);
        let len = data.length;
        let proto: string;
        if (reply) {
            proto = `PUB ${subject} ${reply} ${len}`;
        } else {
            proto = `PUB ${subject} ${len}`;
        }
        this.sendCommand(this.buildProtocolMessage(proto, data))
    }

    subscribe(s: Sub): Subscription {
        if (this.isClosed()) {
            throw NatsError.errorForCode(ErrorCode.CONN_CLOSED);
        }
        if (this.draining) {
            throw NatsError.errorForCode(ErrorCode.CONN_DRAINING);
        }
        let sub = this.subscriptions.add(s) as Sub;
        if (sub.queue) {
            this.sendCommand(this.buildProtocolMessage(`SUB ${sub.subject} ${sub.queue} ${sub.sid}`));
        } else {
            this.sendCommand(this.buildProtocolMessage(`SUB ${sub.subject} ${sub.sid}`));
        }
        if (s.max) {
            this.unsubscribe(this.ssid, s.max);
        }
        return new Subscription(sub, this);
    }

    drainSubscription(sid: number): Promise<SubEvent> {
        if (this.closed) {
            return Promise.reject(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
        }

        if (!sid) {
            return Promise.reject(NatsError.errorForCode(ErrorCode.SUB_CLOSED));
        }
        let s = this.subscriptions.get(sid);
        if (!s) {
            return Promise.reject(NatsError.errorForCode(ErrorCode.SUB_CLOSED));
        }
        if (s.draining) {
            return Promise.reject(NatsError.errorForCode(ErrorCode.SUB_DRAINING));
        }

        let sub = s;
        return new Promise((resolve) => {
            sub.draining = true;
            this.sendCommand(this.buildProtocolMessage(`UNSUB ${sid}`));
            this.flush(() => {
                this.subscriptions.cancel(sub);
                resolve({sid: sub.sid, subject: sub.subject, queue: sub.queue} as SubEvent);
            });
        })
    }

    unsubscribe(sid: number, max?: number) {
        if (!sid || this.closed) {
            return;
        }
        let s = this.subscriptions.get(sid);
        if (s) {
            if (max) {
                this.sendCommand(this.buildProtocolMessage(`UNSUB ${sid} ${max}`));
            } else {
                this.sendCommand(this.buildProtocolMessage(`UNSUB ${sid}`));
            }
            s.max = max;
            if (s.max === undefined || s.received >= s.max) {
                this.subscriptions.cancel(s);
            }
        }
    }

    request(r: Req): Request {
        if (this.closed) {
            throw NatsError.errorForCode(ErrorCode.CONN_CLOSED);
        }
        if (this.draining) {
            throw NatsError.errorForCode(ErrorCode.CONN_DRAINING);
        }
        this.initMux();
        this.muxSubscriptions.add(r);
        return new Request(r, this);
    }

    numSubscriptions(): number {
        return this.subscriptions.length;
    }

    isClosed(): boolean {
        return this.closed;
    }

    cancelRequest(token: string, max?: number): void {
        if (!token || this.isClosed()) {
            return;
        }
        let r = this.muxSubscriptions.get(token);
        if (r) {
            r.max = max;
            if (r.max === undefined || r.received >= r.max) {
                this.muxSubscriptions.cancel(r);
            }
        }
    }

    private connect(): Promise<Transport> {
        this.prepareConnection();
        if (this.currentServer.didConnect) {
            this.client.emit('reconnecting', this.url.href);
        }
        return this.transport.connect(this.url);
    }

    private flushPending(): void {
        if (!this.infoReceived) {
            return;
        }

        if (this.outbound.size()) {
            let d = this.outbound.drain();
            this.transport.write(d);
        }
    }

    private buildProtocolMessage(protocol: string, payload?: Buffer): Buffer {
        let protoLen = Buffer.byteLength(protocol);
        let cmd = protoLen + 2;
        let len = cmd;
        if (payload) {
            len += payload.byteLength + 2;
        }
        let buf = Buffer.allocUnsafe(len);
        buf.write(protocol);
        CRLF_BUF.copy(buf, protoLen);
        if (payload) {
            payload.copy(buf, cmd);
            CRLF_BUF.copy(buf, buf.byteLength - 2);
        }
        return buf;
    }

    private sendCommand(cmd: string | Buffer): void {
        // Buffer to cut down on system calls, increase throughput.
        // When receive gets faster, should make this Buffer based..

        if (this.closed) {
            return;
        }

        let buf: Buffer;
        if (typeof cmd === 'string') {
            let len = Buffer.byteLength(cmd);
            buf = Buffer.allocUnsafe(len);
            buf.write(cmd, 0, len, 'utf8');
        } else {
            buf = cmd as Buffer;
        }

        if (buf.byteLength === 0) {
            return;
        }

        this.outbound.fill(buf);
        if (this.outbound.length() === 1) {
            setImmediate(() => {
                this.flushPending();
            });
        } else if (this.outbound.size() > FLUSH_THRESHOLD) {
            this.flushPending();
        }
    }

    private getTransportHandlers(): TransportHandlers {
        let handlers = {} as TransportHandlers;
        handlers.connect = () => {
            if (this.pingTimer) {
                clearTimeout(this.pingTimer);
                delete this.pingTimer;
            }
            this.connected = true;
            this.scheduleHeartbeat();
        };

        handlers.close = () => {
            let wasConnected = this.connected;
            this.closeStream();

            //@ts-ignore - guaranteed to be set
            let mra = parseInt(this.options.maxReconnectAttempts, 10);
            if (wasConnected) {
                this.client.emit('disconnect', this.currentServer.url.href);
            }
            if (this.closed) {
                this.client.close();
                this.client.emit('close');
            } else if (this.options.reconnect === false) {
                this.client.close();
                this.client.emit('close');
            } else if (mra > -1 && this.reconnects >= mra) {
                this.client.close();
                this.client.emit('close');
            } else {
                this.scheduleReconnect();
            }
        };

        handlers.error = (exception: Error) => {
            // If we were connected just return, close event will process
            if (this.wasConnected && this.currentServer.didConnect) {
                return;
            }

            // if the current server did not connect at all, and we in
            // general have not connected to any server, remove it from
            // this list. Unless overridden
            if (!this.wasConnected && !this.currentServer.didConnect) {
                // We can override this behavior with waitOnFirstConnect, which will
                // treat it like a reconnect scenario.
                if (this.options.waitOnFirstConnect) {
                    // Pretend to move us into a reconnect state.
                    this.currentServer.didConnect = true;
                } else {
                    this.servers.removeCurrentServer();
                }
            }

            // Only bubble up error if we never had connected
            // to the server and we only have one.
            if (!this.wasConnected && this.servers.length() === 0) {
                this.client.emit('error', new NatsError(CONN_ERR_PREFIX + exception, ErrorCode.CONN_ERR, exception));
            }
            this.closeStream();
        };

        handlers.data = (data: Buffer) => {
            // If inbound exists, concat them together. We try to avoid this for split
            // messages, so this should only really happen for a split control line.
            // Long term answer is hand rolled parser and not regexp.
            this.inbound.fill(data);

            // Process the inbound queue.
            this.processInbound();
        };

        return handlers;
    }

    private prepareConnection(): void {
        // Commands may have been queued during reconnect. Discard everything except:
        // 1) ping requests with a pong callback
        // 2) publish requests
        //
        // Rationale: CONNECT and SUBs are written directly upon connecting, any PONG
        // response is no longer relevant, and any UNSUB will be accounted for when we
        // sync our SUBs. Without this, users of the client may miss state transitions
        // via callbacks, would have to track the client's internal connection state,
        // and may have to double buffer messages (which we are already doing) if they
        // wanted to ensure their messages reach the server.

        // copy outbound and reset it
        let buffers = this.outbound.reset();
        let pongs = [] as Callback[];
        if (buffers.length) {
            let pongIndex = 0;
            // find all the pings with associated callback, and pubs
            buffers.forEach((buf) => {
                let cmd = buf.toString('binary');
                if (PING.test(cmd) && this.pongs !== null && pongIndex < this.pongs.length) {
                    let f = this.pongs[pongIndex++];
                    if (f) {
                        this.outbound.fill(buf);
                        pongs.push(f);
                    }
                } else if (cmd.length > 3 && cmd[0] === 'P' && cmd[1] === 'U' && cmd[2] === 'B') {
                    this.outbound.fill(buf);
                }
            });
        }
        this.pongs = pongs;
        this.state = ParserState.AWAITING_CONTROL;

        // Clear info processing.
        this.info = {} as ServerInfo;
        this.infoReceived = false;

        // Select a server to connect to.
        this.selectServer();
    };

    getInfo(): ServerInfo | null {
        if (this.infoReceived) {
            return this.info;
        }
        return null;
    }

    /**
     * Strips all SUBS commands from pending during initial connection completed since
     * we send the subscriptions as a separate operation.
     *
     * @api private
     */
    private stripPendingSubs(): void {
        if (this.outbound.size() === 0) {
            return;
        }

        // FIXME: outbound doesn't peek so there's no packing
        let buffers = this.outbound.reset();
        for (let i = 0; i < buffers.length; i++) {
            let s = buffers[i].toString('binary');
            if (!SUBRE.test(s)) {
                // requeue the command
                this.sendCommand(buffers[i]);
            }
        }
    }

    /**
     * Sends existing subscriptions to new server after reconnect.
     *
     * @api private
     */
    private sendSubscriptions(): void {
        if (this.subscriptions.length === 0 || !this.transport.isConnected()) {
            return;
        }
        let cmds: string[] = [];
        this.subscriptions.all().forEach((s) => {
            if (s.queue) {
                cmds.push(`${SUB} ${s.subject} ${s.queue} ${s.sid} ${CR_LF}`);
            } else {
                cmds.push(`${SUB} ${s.subject} ${s.sid} ${CR_LF}`);
            }
        });
        if (cmds.length) {
            this.transport.write(cmds.join(''));
        }
    }

    /**
     * Process the inbound data queue.
     *
     * @api private
     */
    private processInbound(): void {
        // Hold any regex matches.
        let m;

        // For optional yield
        let start;

        if (!this.transport) {
            // if we are here, the stream was reaped and errors raised
            // if we continue.
            return;
        }
        // unpause if needed.
        this.transport.resume();

        if (this.options.yieldTime !== undefined) {
            start = Date.now();
        }

        while (!this.closed && this.inbound.size()) {
            switch (this.state) {
                case ParserState.AWAITING_CONTROL:
                    // Regex only works on strings, so convert once to be more efficient.
                    // Long term answer is a hand rolled parser, not regex.
                    let len = this.inbound.protoLen();
                    if (len === -1) {
                        return;
                    }
                    let bb = this.inbound.drain(len);
                    if (bb.byteLength === 0) {
                        return;
                    }
                    // specifying an encoding here like 'ascii' slows it down
                    let buf = bb.toString();

                    if ((m = MSG.exec(buf)) !== null) {
                        this.msgBuffer = new MsgBuffer(m, this.payload, this.encoding);
                        this.state = ParserState.AWAITING_MSG_PAYLOAD;
                    } else if ((m = OK.exec(buf)) !== null) {
                        // Ignore for now..
                    } else if ((m = ERR.exec(buf)) !== null) {
                        if (this.processErr(m[1])) {
                            return;
                        }
                    } else if ((m = PONG.exec(buf)) !== null) {
                        this.pout = 0;
                        let cb = this.pongs && this.pongs.shift();
                        if (cb) {
                            try {
                                cb();
                            } catch (err) {
                                console.error('error while processing pong', err);
                            }
                        } // FIXME: Should we check for exceptions?
                    } else if ((m = PING.exec(buf)) !== null) {
                        this.sendCommand(this.buildProtocolMessage('PONG'));
                    } else if ((m = INFO.exec(buf)) !== null) {
                        this.info = JSON.parse(m[1]);
                        // Check on TLS mismatch.
                        if (this.checkTLSMismatch()) {
                            return;
                        }
                        if (this.checkNoEchoMismatch()) {
                            return;
                        }

                        if (this.checkNonceSigner()) {
                            return;
                        }
                        // Always try to read the connect_urls from info
                        let change = this.servers.processServerUpdate(this.info);
                        if (change.deleted.length > 0 || change.added.length > 0) {
                            this.client.emit('serversChanged', change);
                        }

                        // Process first INFO
                        if (!this.infoReceived) {
                            // Switch over to TLS as needed.

                            // are we a tls socket?
                            let encrypted = this.transport.isEncrypted();
                            if (this.info.tls_required === true && !encrypted) {
                                this.transport.upgrade(this.options.tls, () => {
                                    this.flushPending();
                                });
                            }

                            // Send the connect message and subscriptions immediately
                            let cs = JSON.stringify(new Connect(this.currentServer, this.options, this.info));
                            this.transport.write(`${CONNECT} ${cs}${CR_LF}`);
                            this.sendSubscriptions();
                            this.pongs.unshift(() => {
                                this.connectCB();
                            });
                            this.transport.write(this.buildProtocolMessage('PING'));

                            // Mark as received
                            this.infoReceived = true;
                            this.stripPendingSubs();
                            this.flushPending();
                        }
                    } else {
                        // FIXME, check line length for something weird.
                        // Nothing here yet, return
                        return;
                    }
                    break;

                case ParserState.AWAITING_MSG_PAYLOAD:
                    if (!this.msgBuffer) {
                        break;
                    }
                    // wait for more data to arrive
                    if (this.inbound.size() < this.msgBuffer.length) {
                        return;
                    }
                    // drain the number of bytes we need
                    let dd = this.inbound.drain(this.msgBuffer.length);
                    this.msgBuffer.fill(dd);
                    this.processMsg();
                    this.state = ParserState.AWAITING_CONTROL;
                    this.msgBuffer = null;

                    // Check to see if we have an option to yield for other events after yieldTime.
                    if (start !== undefined && this.options && this.options.yieldTime) {
                        if ((Date.now() - start) > this.options.yieldTime) {
                            this.transport.pause();
                            this.client.emit('yield');
                            setImmediate(() => {
                                this.processInbound();
                            });
                            return;
                        }
                    }
                    break;
            }
        }
    }

    private clientTLSRequirement(): TlsRequirement {
        if (this.options.tls === undefined) {
            return TlsRequirement.ANY;
        }
        if (this.options.tls === false) {
            return TlsRequirement.OFF;
        }
        return TlsRequirement.ON;
    }

    /**
     * Check for TLS configuration mismatch.
     *
     * @api private
     */
    private checkTLSMismatch(): boolean {
        switch (this.clientTLSRequirement()) {
            case TlsRequirement.OFF:
                if (this.info.tls_required) {
                    this.client.emit('error', NatsError.errorForCode(ErrorCode.SECURE_CONN_REQ));
                    this.closeStream();
                    return true;
                }
                break;
            case TlsRequirement.ON:
                if (!this.info.tls_required) {
                    this.client.emit('error', NatsError.errorForCode(ErrorCode.NON_SECURE_CONN_REQ));
                    this.closeStream();
                    return true;
                }
                break;
            case TlsRequirement.ANY:
                // tls auto-upgrade
                break;
        }

        let cert = false;
        if (this.options.tls && typeof this.options.tls === 'object') {
            cert = this.options.tls.cert != null;
        }
        if (this.info.tls_verify && !cert) {
            this.client.emit('error', NatsError.errorForCode(ErrorCode.CLIENT_CERT_REQ));
            this.closeStream();
            return true;
        }
        return false;
    }

    /**
     * Check no echo
     * @api private
     */
    private checkNoEchoMismatch(): boolean {
        if ((this.info.proto === undefined || this.info.proto < 1) && this.options.noEcho) {
            this.client.emit('error', NatsError.errorForCode(ErrorCode.NO_ECHO_NOT_SUPPORTED));
            this.closeStream();
            return true;
        }
        return false;
    }

    private checkNonceSigner(): boolean {
        if (this.info.nonce === undefined) {
            return false;
        }

        if (this.options.nkeyCreds) {
            try {
                let seed = nkeys.fromSeed(this.getNkeyCreds());
                this.options.nkey = seed.getPublicKey().toString();
                this.options.nonceSigner = (nonce: string): any => {
                    return this.nkeyNonceSigner(Buffer.from(nonce));
                }
            } catch (err) {
                this.client.emit('error', err);
                this.closeStream();
                return true;
            }
        }

        if (this.options.userCreds) {
            try {
                // simple test that we got a creds file - exception is thrown
                // if the file is not a valid creds file
                this.getUserCreds(true);
                this.options.nonceSigner = (nonce: string): any => {
                    return this.credsNonceSigner(Buffer.from(nonce));
                };

                this.options.userJWT = () => {
                    return this.loadJwt();
                }

            } catch (err) {
                this.client.emit('error', err);
                this.closeStream();
                return true;
            }
        }

        if (this.options.nonceSigner === undefined) {
            this.client.emit('error', NatsError.errorForCode(ErrorCode.SIGNATURE_REQUIRED));
            this.closeStream();
            return true;
        }

        if (this.options.nkey === undefined && this.options.userJWT === undefined) {
            this.client.emit('error', NatsError.errorForCode(ErrorCode.NKEY_OR_JWT_REQ));
            this.closeStream();
            return true;
        }
        return false;
    }

    private getNkeyCreds(): Buffer {
        if (this.options.nkeyCreds) {
            return fs.readFileSync(this.options.nkeyCreds);
        }
        throw NatsError.errorForCode(ErrorCode.BAD_NKEY_SEED);
    }

    // returns a regex array - first match is the jwt, second match is the nkey
    private getUserCreds(jwt = false): RegExpExecArray {
        if (this.options.userCreds) {
            let buf = fs.readFileSync(this.options.userCreds);
            if (buf) {
                let re = jwt ? CREDS : new RegExp(CREDS, 'g');
                let contents = buf.toString();

                // first match jwt
                let m = re.exec(contents);
                if (m === null) {
                    throw NatsError.errorForCode(ErrorCode.BAD_CREDS);
                }
                if (jwt) {
                    return m;
                }
                // second match the seed
                m = re.exec(contents);
                if (m === null) {
                    throw NatsError.errorForCode(ErrorCode.BAD_CREDS);
                }
                return m;
            }
        }
        throw NatsError.errorForCode(ErrorCode.BAD_CREDS);
    }

    // built-in handler for signing nonces based on a nkey seed file
    private nkeyNonceSigner(nonce: Buffer): any {
        try {
            let m = this.getNkeyCreds();
            let sk = nkeys.fromSeed(m);
            return sk.sign(nonce)
        } catch (ex) {
            this.closeStream();
            this.client.emit('error', ex)
        }
    }

    // built-in handler for signing nonces based on user creds file
    private credsNonceSigner(nonce: Buffer): any {
        try {
            let m = this.getUserCreds();
            let sk = nkeys.fromSeed(Buffer.from(m[1]));
            return sk.sign(nonce)
        } catch (ex) {
            this.closeStream();
            this.client.emit('error', ex)
        }
    }

    // built-in handler for loading user jwt based on user creds file
    private loadJwt(): any {
        try {
            let m = this.getUserCreds(true);
            return m[1];
        } catch (ex) {
            this.closeStream();
            this.client.emit('error', ex)
        }
    }

    /**
     * Process a delivered message and deliver to appropriate subscriber.
     *
     * @api private
     */
    private processMsg(): void {
        if (this.subscriptions.length === 0 || !this.msgBuffer) {
            return;
        }
        let sub = this.subscriptions.get(this.msgBuffer.msg.sid);
        if (!sub) {
            return;
        }
        sub.received += 1;

        // cancel the timeout if we got the expected number of messages
        if (sub.timeout && (sub.max === undefined || sub.received >= sub.max)) {
            Subscription.cancelTimeout(sub);
        }

        // if we got max number of messages, unsubscribe
        if (sub.max !== undefined && sub.received >= sub.max) {
            this.unsubscribe(sub.sid);
        }

        if (sub.callback) {
            try {
                if (this.msgBuffer.error) {
                    sub.callback(this.msgBuffer.error, this.msgBuffer.msg);
                } else {
                    sub.callback(null, this.msgBuffer.msg);
                }
            } catch (error) {
                // client could have died
                console.log(error);
                this.client.emit('error', error);
            }
        }
    };

    static toError(s: string) {
        let t = s ? s.toLowerCase() : '';
        if (t.indexOf('permissions violation') !== -1) {
            return new NatsError(s, ErrorCode.PERMISSIONS_VIOLATION);
        } else if (t.indexOf('authorization violation') !== -1) {
            return new NatsError(s, ErrorCode.AUTHORIZATION_VIOLATION);
        } else {
            return new NatsError(s, ErrorCode.NATS_PROTOCOL_ERR);
        }
    }

    /**
     * ProcessErr processes any error messages from the server
     * Return true if the error closed the connection
     * @api private
     */
    private processErr(s: string): boolean {
        // current NATS clients, will raise an error and close on any errors
        // except stale connection and permission errors
        let err = ProtocolHandler.toError(s);
        switch(err.code) {
            case ErrorCode.AUTHORIZATION_VIOLATION:
                this.client.emit('error', err);
                // closeStream() triggers a reconnect if allowed
                this.closeStream();
                return true;
            case ErrorCode.PERMISSIONS_VIOLATION:
                // just emit
                this.client.emit('permissionError', err);
                return false;
            default:
                this.client.emit('error', err);
                // closeStream() triggers a reconnect if allowed
                this.closeStream();
                return true;
        }
    };

    /**
     * Close down the stream and clear state.
     *
     * @api private
     */
    private closeStream(): void {
        this.transport.destroy();
        if (this.connected || this.closed) {
            this.pongs = [];
            this.pout = 0;
            this.connected = false;
            this.inbound.reset();
        }
    };

    /**
     * Setup a timer event to attempt reconnect.
     *
     * @api private
     */
    private scheduleReconnect(): void {
        let ph = this;
        // Just return if no more servers
        if (ph.servers.length() === 0) {
            return;
        }
        // Don't set reconnecting state if we are just trying
        // for the first time.
        if (ph.wasConnected) {
            ph.reconnecting = true;
        }
        // Only stall if we have connected before.
        let wait = 0;
        let s = ph.servers.next();
        if (s && s.didConnect && this.options.reconnectTimeWait !== undefined) {
            wait = this.options.reconnectTimeWait;
        }
        setTimeout(() => {
            ph.reconnect();
        }, wait);
    }

    private scheduleHeartbeat(): void {
        this.pingTimer = setTimeout(() => {
            this.client.emit('pingtimer');
            if (this.closed) {
                return;
            }
            // we could be waiting on the socket to connect
            if (this.transport.isConnected()) {
                this.client.emit('pingcount', this.pout);
                this.pout++;
                // @ts-ignore
                if (this.pout > this.options.maxPingOut) {
                    // processErr will scheduleReconnect
                    this.processErr(STALE_CONNECTION_ERR);
                    // don't reschedule, new connection initiated
                    return;
                } else {
                    // send the ping
                    this.sendCommand(this.buildProtocolMessage('PING'));
                    if (this.pongs) {
                        // no callback
                        this.pongs.push(undefined);
                    }

                }
            }
            // reschedule
            this.scheduleHeartbeat();
        }, this.options.pingInterval || DEFAULT_PING_INTERVAL, this);
    }

    /**
     * Reconnect to the server.
     *
     * @api private
     */
    private reconnect(): void {
        if (this.closed) {
            return;
        }
        this.reconnects += 1;
        this.connect().then(() => {
            // all good the pong handler deals with it
        }).catch(() => {
            // the stream handler deals with it
        });
    }

    /**
     * Properly select the next server.
     * We rotate the server list as we go,
     * we also pull auth from urls as needed, or
     * if they were set in options use that as override.
     *
     * @api private
     */
    private selectServer(): void {
        let server = this.servers.selectServer();
        if (server === undefined) {
            return;
        }

        // Place in client context.
        this.currentServer = server;
        this.url = server.url;
    }

    private toBuffer(data: any = undefined): Buffer {
        if (this.options.payload === Payload.JSON) {
            // undefined is not a valid JSON-serializable value, but null is
            data = data === undefined ? null : data;
            try {
                data = JSON.stringify(data);
            } catch (e) {
                throw NatsError.errorForCode(ErrorCode.BAD_JSON);
            }
        } else {
            data = data || EMPTY;
        }

        // if not a buffer, it is already serialized json or a string
        if (!Buffer.isBuffer(data)) {
            // must be utf8 - omitting encoding to prevent clever change
            data = Buffer.from(data);
        }
        return data;
    }

    private initMux(): void {
        let mux = this.subscriptions.getMux();
        if (!mux) {
            let inbox = this.muxSubscriptions.init();
            let sub = defaultSub();
            // dot is already part of mux
            sub.subject = `${inbox}*`;
            sub.callback = this.muxSubscriptions.dispatcher();
            this.subscriptions.setMux(sub);
            this.subscribe(sub);
        }
    }

    /**
     * Callback for first flush/connect.
     *
     * @api private
     */
    private connectCB(): void {
        let event = this.reconnecting ? 'reconnect' : 'connect';
        this.reconnecting = false;
        this.reconnects = 0;
        this.wasConnected = true;
        if (this.currentServer) {
            this.currentServer.didConnect = true;
        }

        // copy the info
        let info: ServerInfo = {} as ServerInfo;
        try {
            info = JSON.parse(JSON.stringify(this.info));
        } catch (err) {
            // ignore
        }

        this.client.emit(event, this.client, this.currentServer.url.href, info);
        this.flushPending();
    }
}


export class Request {
    token: string;
    private protocol: ProtocolHandler;

    constructor(req: Req, protocol: ProtocolHandler) {
        this.token = req.token;
        this.protocol = protocol;
    }

    cancel(): void {
        this.protocol.cancelRequest(this.token, 0);
    }
}

export class Connect {
    lang: string = 'typescript';
    version: string = VERSION;
    verbose: boolean = false;
    pedantic: boolean = false;
    protocol: number = 1;
    user?: string;
    pass?: string;
    auth_token?: string;
    name?: string;
    echo?: boolean;
    sig?: string;
    jwt?: string;
    nkey?: string;

    constructor(server: Server, opts: NatsConnectionOptions, info: ServerInfo) {
        opts = opts || {} as NatsConnectionOptions;
        if (opts.user) {
            this.user = opts.user;
            this.pass = opts.pass;
        }
        if (opts.token) {
            this.auth_token = opts.token;
        }

        let auth = server.getCredentials();
        if (auth) {
            if (auth.length !== 1) {
                if (this.user === undefined) {
                    this.user = auth[0];
                }
                if (this.pass === undefined) {
                    this.pass = auth[1];
                }
            } else if (this.auth_token === undefined) {
                this.auth_token = auth[0];
            }
        }

        if (opts.name) {
            this.name = opts.name;
        }
        if (opts.verbose !== undefined) {
            this.verbose = opts.verbose;
        }

        if (opts.pedantic !== undefined) {
            this.pedantic = opts.pedantic;
        }
        if (opts.noEcho) {
            this.echo = false;
        }
        if (info.nonce && opts.nonceSigner) {
            let sig = opts.nonceSigner(info.nonce);
            this.sig = sig.toString('base64');
        }
        if (opts.userJWT) {
            if (typeof opts.userJWT === 'function') {
                this.jwt = opts.userJWT();
            } else {
                this.jwt = opts.userJWT;
            }
        }
        if (opts.nkey) {
            this.nkey = opts.nkey;
        }
    }
}
