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

import {Client, defaultSub, FlushCallback, Msg, NatsConnectionOptions, Payload, Req, Sub, Subscription} from "./nats";
import {MuxSubscriptions} from "./muxsubscriptions";
import {Callback, Transport, TransportHandlers} from "./transport";
import {ServerInfo} from "./types";
import {CONN_ERR_PREFIX, ErrorCode, NatsError} from "./error";

import {EventEmitter} from "events";
import {CR_LF, DEFAULT_PING_INTERVAL, EMPTY} from "./const";
import {Server, Servers} from "./servers";
import {TCPTransport} from "./tcptransport";
import {Subscriptions} from "./subscriptions";
import {DataBuffer} from "./databuffer";
import {MsgBuffer} from "./messagebuffer";
import url = require('url');
import Timer = NodeJS.Timer;


const PERMISSIONS_ERR = "permissions violation";
const STALE_CONNECTION_ERR = "stale connection";
const MAX_CONTROL_LINE_SIZE = 1024,


    // Protocol
    MSG = /^MSG\s+([^\s\r\n]+)\s+([^\s\r\n]+)\s+(([^\s\r\n]+)[^\S\r\n]+)?(\d+)\r\n/i,
    OK = /^\+OK\s*\r\n/i,
    ERR = /^-ERR\s+('.+')?\r\n/i,
    PING = /^PING\r\n/i,
    PONG = /^PONG\r\n/i,
    INFO = /^INFO\s+([^\r\n]+)\r\n/i,
    SUBRE = /^SUB\s+([^\r\n]+)\r\n/i,


    // Protocol
    //PUB     = 'PUB', // TODO: remove / never used
    SUB = 'SUB',
    CONNECT = 'CONNECT',

    // Responses
    PING_REQUEST = 'PING' + CR_LF,
    PONG_RESPONSE = 'PONG' + CR_LF,

    FLUSH_THRESHOLD = 65536;

// Parser state
enum ParserState {
    CLOSED = -1,
    AWAITING_CONTROL = 0,
    AWAITING_MSG_PAYLOAD = 1
}

export class ProtocolHandler extends EventEmitter {
    static VERSION = "1.0.0";
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
    private pass?: string;
    private payload: Payload;
    private pingTimer?: Timer;
    private pongs: any[] = [];
    private pout: number = 0;
    private reconnecting: boolean = false;
    private reconnects: number = 0;
    private servers: Servers;
    private ssid: number = 1;
    private state: ParserState = ParserState.AWAITING_CONTROL;
    private token?: string;
    private transport: Transport;
    private url!: url.UrlObject;
    private user?: string;
    private wasConnected: boolean = false;

    constructor(client: Client, options: NatsConnectionOptions) {
        super();
        EventEmitter.call(this);

        this.client = client;
        this.options = options;
        this.encoding = options.encoding || "utf8";
        this.payload = options.payload || Payload.STRING;

        // Set user/pass/token as needed if in options.
        this.user = options.user;
        this.pass = options.pass;
        this.token = options.token;
        this.subscriptions = new Subscriptions();
        this.servers = new Servers(!this.options.noRandomize, this.options.servers || [], this.options.url);
        this.transport = new TCPTransport(this.getTransportHandlers());
    }

    static connect(client: Client, opts: NatsConnectionOptions): Promise<ProtocolHandler> {
        return new Promise<ProtocolHandler>((resolve, reject) => {
            let ph = new ProtocolHandler(client, opts);
            ph.connect()
                .then(() => {
                    resolve(ph);
                })
                .catch((ex) => {
                    reject(ex);
                });
        });
    }

    flush(cb: FlushCallback): void {
        if (this.closed) {
            if (typeof cb === 'function') {
                cb(NatsError.errorForCode(ErrorCode.CONN_CLOSED));
                return;
            } else {
                throw (NatsError.errorForCode(ErrorCode.CONN_CLOSED));
            }
        }
        this.pongs.push(cb);
        this.sendCommand(this.buildProtocolMessage('PING'));
    }

    /**
     * Close the connection to the server.
     *
     * @api public
     */
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
        this.state = ParserState.CLOSED;
        this.pongs = [];
        this.outbound.reset();
    };

    publish(subject: string, data: any, reply: string = ""): void {
        if (this.closed) {
            throw (NatsError.errorForCode(ErrorCode.CONN_CLOSED));
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
        let sub = this.subscriptions.add(s) as Sub;
        if (sub.queue) {
            this.sendCommand(this.buildProtocolMessage(`SUB ${sub.subject} ${sub.queue} ${sub.sid}`));
        } else {
            this.sendCommand(this.buildProtocolMessage(`SUB ${sub.subject} ${sub.sid}`));
        }
        if (s.max) {
            this.unsubscribe(this.ssid, s.max);
        }
        this.client.emit('subscribe', s.sid, s.subject);
        return new Subscription(sub, this);
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

    /**
     * Publish a message with an implicit inbox listener as the reply. Message is optional.
     * This should be treated as a subscription. You can optionally indicate how many
     * messages you only want to receive using opt_options = {max:N}. Otherwise you
     * will need to unsubscribe to stop the message stream.
     *
     * You can also optionally specify the number of milliseconds to wait for the messages
     * to receive using opt_options = {timeout: N}. When the number of messages specified
     * is received before a timeout, the subscription auto-cancels. If the number of messages
     * is not specified, it is the responsibility of the client to unsubscribe to prevent
     * a timeout.
     *
     * The Subscriber Id is returned.
     *
     * @param {String} subject
     * @param {String} [data]
     * @param {Object} [opt_options]
     * @param {Function} [callback]
     * @return {Number}
     * @api public
     */
    request(r: Req): Request {
        if (this.closed) {
            throw (NatsError.errorForCode(ErrorCode.CONN_CLOSED));
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
        return this.transport.connect(this.url);
    }

    private flushPending() {
        if (!this.infoReceived) {
            return;
        }

        if (this.outbound.size()) {
            let d = this.outbound.drain();
            this.transport.write(d);
        }
    }

    // protocol shoudn't have crlf
    // payload shouldn't have crlf
    private buildProtocolMessage(protocol: string, payload?: Buffer): Buffer {
        let crlf = Buffer.from('\r\n');
        let protoLen = Buffer.byteLength(protocol);
        let cmd = protoLen + 2;
        let len = cmd;
        if (payload) {
            len += payload.byteLength + 2;
        }
        let buf = Buffer.allocUnsafe(len);
        buf.write(protocol);
        crlf.copy(buf, protoLen);
        if (payload) {
            payload.copy(buf, cmd);
            crlf.copy(buf, buf.byteLength - 2);
        }
        return buf;
    }

    /**
     * Send commands to the server or queue them up if connection pending.
     *
     * @api private
     */
    private sendCommand(cmd: string | Buffer): void {
        // Buffer to cut down on system calls, increase throughput.
        // When receive gets faster, should make this Buffer based..

        if (this.closed) {
            return;
        }

        let buf: Buffer;
        if (typeof cmd === 'string') {
            buf = Buffer.from(cmd, "utf8");
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

    /**
     * Properly setup a stream event handlers.
     *
     * @api private
     */
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
            this.closeStream();
            this.client.emit('disconnect');
            if (this.closed ||
                this.options.reconnect === false ||
                //@ts-ignore FIXME: MAR the parsed options need to help typescript catch missing values
                ((this.reconnects >= this.options.maxReconnectAttempts) && this.options.maxReconnectAttempts !== -1)) {
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
            // this list. Unless overidden
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

    /**
     * Properly setup a stream connection with proper events.
     *
     * @api private
     */
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
        if (this.outbound.length()) {
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

    /**
     * Close down the stream and clear state.
     *
     * @api private
     */
    private closeStream(): void {
        this.transport.destroy();
        if (this.connected === true || this.closed === true) {
            this.pongs = [];
            this.pout = 0;
            this.connected = false;
            this.inbound.reset();
            this.outbound.reset();
        }
    };

    /**
     * Strips all SUBS commands from pending during initial connection completed since
     * we send the subscriptions as a separate operation.
     *
     * @api private
     */
    private stripPendingSubs() {
        if (this.outbound.size() === 0) {
            return;
        }

        // FIXME: outbound doesn't peek so there's no packing
        let buffers = this.outbound.reset();
        for (let i = 0; i < buffers.length; i++) {
            let s = buffers[i].toString("binary");
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
        // FIXME(dlc) client.stream.isPaused() causes 0.10 to fail
        this.transport.resume();

        if (this.options.yieldTime !== undefined) {
            start = Date.now();
        }

        while (!this.closed && this.inbound.size()) {
            switch (this.state) {

                case ParserState.AWAITING_CONTROL:
                    // Regex only works on strings, so convert once to be more efficient.
                    // Long term answer is a hand rolled parser, not regex.
                    let buf = this.inbound.peek().toString('binary', 0, MAX_CONTROL_LINE_SIZE);

                    if ((m = MSG.exec(buf)) !== null) {
                        this.msgBuffer = new MsgBuffer(m, this.payload, this.encoding);
                        this.state = ParserState.AWAITING_MSG_PAYLOAD;
                    } else if ((m = OK.exec(buf)) !== null) {
                        // Ignore for now..
                    } else if ((m = ERR.exec(buf)) !== null) {
                        this.processErr(m[1]);
                        return;
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
                        if (this.checkTLSMismatch() === true) {
                            return;
                        }

                        // Always try to read the connect_urls from info
                        let newServers = this.servers.processServerUpdate(this.info);
                        if (newServers.length > 0) {
                            this.client.emit('serversDiscovered', newServers);
                        }

                        // Process first INFO
                        if (!this.infoReceived) {
                            // Switch over to TLS as needed.

                            // are we a tls socket?
                            let encrypted = this.transport.isEncrypted();
                            if (this.options.tls !== false && !encrypted) {
                                this.transport.upgrade(this.options.tls, () => {
                                    this.flushPending();
                                });
                            }

                            // Send the connect message and subscriptions immediately
                            let cs = JSON.stringify(new Connect(this.options));
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
                    // drain what we have collected
                    if (this.inbound.size() < this.msgBuffer.length) {
                        let d = this.inbound.drain();
                        this.msgBuffer.fill(d);
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
                            setImmediate(this.processInbound.bind(this));
                            return;
                        }
                    }
                    break;
            }

            // This is applicable for a regex match to eat the bytes we used from a control line.
            if (m) {
                // Chop inbound
                let payloadSize = m[0].length;
                if (payloadSize >= this.inbound.size()) {
                    this.inbound.drain();
                } else {
                    this.inbound.drain(payloadSize);
                }
                m = null;
            }
        }
    }

    /**
     * Check for TLS configuration mismatch.
     *
     * @api private
     */
    private checkTLSMismatch(): boolean {
        if (this.info.tls_required &&
            this.options.tls === false) {
            this.client.emit('error', NatsError.errorForCode(ErrorCode.SECURE_CONN_REQ));
            this.closeStream();
            return true;
        }

        if (!this.info.tls_required &&
            this.options.tls !== false) {
            this.client.emit('error', NatsError.errorForCode(ErrorCode.NON_SECURE_CONN_REQ));
            this.closeStream();
            return true;
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
            this.client.emit('unsubscribe', sub.sid, sub.subject);
        }

        if (sub.callback) {
            try {
                if (this.msgBuffer.error) {
                    let empty = {sid: sub.sid, size: 0, reply: "", subject: sub.subject} as Msg;
                    sub.callback(this.msgBuffer.error, empty);
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
        let t = s ? s.toLowerCase() : "";
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
     *
     * @api private
     */
    private processErr(s: string): void {
        // current NATS clients, will raise an error and close on any errors
        // except stale connection and permission errors
        let err = ProtocolHandler.toError(s);
        switch(err.code) {
            case ErrorCode.AUTHORIZATION_VIOLATION:
                this.client.emit('error', err);
                // closeStream() triggers a reconnect if allowed
                this.closeStream();
                break;
            case ErrorCode.PERMISSIONS_VIOLATION:
                // just emit
                this.client.emit('permission_error', err);
                break;
            default:
                this.client.emit('error', err);
                // closeStream() triggers a reconnect if allowed
                this.closeStream();
        }
    };

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
        this.prepareConnection();
        if (this.currentServer.didConnect) {
            this.client.emit('reconnecting');
        }
    }

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
        this.client.emit(event, this.client);
        this.flushPending();
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
        let auth = server.getCredentials();
        if (auth) {
            if (auth.length !== 1) {
                if (this.options.user === undefined) {
                    this.user = auth[0];
                }
                if (this.options.pass === undefined) {
                    this.pass = auth[1];
                }
            } else if (this.options.token === undefined) {
                this.token = auth[0];
            }
        }
    }

    private toBuffer(data: any = undefined): Buffer {
        if (this.options.payload === Payload.JSON) {
            // undefined is not a valid JSON-serializable value, but null is
            data = data === undefined ? null : data;
            try {
                data = JSON.stringify(data);
            } catch (e) {
                throw (NatsError.errorForCode(ErrorCode.BAD_JSON));
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
    lang: string = "typescript";
    version: string = ProtocolHandler.VERSION;
    verbose: boolean = false;
    pedantic: boolean = false;
    protocol: number = 1;
    user?: string;
    pass?: string;
    auth_token?: string;
    name?: string;

    constructor(opts?: NatsConnectionOptions) {
        opts = opts || {} as NatsConnectionOptions;
        if (opts.user) {
            this.user = opts.user;
            this.pass = opts.pass;
        }
        if (opts.token) {
            this.auth_token = opts.token;
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
    }
}