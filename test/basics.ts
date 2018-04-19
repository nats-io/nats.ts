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

import * as NATS from '../src/nats';
import {NatsConnectionOptions} from '../src/nats';
import * as nsc from './support/nats_server_control';
import {Server} from './support/nats_server_control';
import {expect} from 'chai';

describe('Basics', function () {

    let PORT = 1423;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should do basic subscribe and unsubscribe', (done) => {
        let nc = NATS.connect(PORT);
        let sid = nc.subscribe('foo');
        expect(sid).to.exist;
        nc.unsubscribe(sid);
        nc.flush(function () {
            nc.close();
            done();
        });
    });

    it('should do basic publish', (done) => {
        let nc = NATS.connect(PORT);
        nc.publish('foo');
        nc.flush(function () {
            nc.close();
            done();
        });
    });

    it('should fire a callback for subscription', (done) => {
        let nc = NATS.connect(PORT);
        nc.subscribe('foo', {}, () => {
            nc.close();
            done();
        });
        nc.publish('foo');
    });

    it('should include the correct message in the callback', (done) => {
        let nc = NATS.connect(PORT);
        let data = 'Hello World';
        nc.subscribe('foo', {}, (msg) => {
            nc.close();
            expect(msg).to.exist;
            expect(msg).to.be.equal(data);
            done();
        });
        nc.publish('foo', data);
    });

    it('should include the correct reply in the callback', (done) => {
        let nc = NATS.connect(PORT);
        let data = 'Hello World';
        let inbox = nc.createInbox();
        nc.subscribe('foo', {}, (msg, reply) => {
            nc.close();
            expect(msg).to.exist;
            expect(msg).to.be.equal(data);
            expect(reply).to.exist;
            expect(reply).to.be.equal(inbox);
            done();
        });
        nc.publish('foo', data, inbox);
    });

    it('should do request-reply', (done) => {
        let nc = NATS.connect(PORT);
        let initMsg = 'Hello World';
        let replyMsg = 'Hello Back!';

        nc.subscribe('foo', {}, (msg, reply) => {
            expect(msg).to.exist;
            expect(msg).to.be.equal(initMsg);
            expect(reply).to.exist;
            expect(reply).to.match(/_INBOX\.*/);
            nc.publish(reply, replyMsg);
        });

        nc.request('foo', initMsg, {}, (reply) => {
            nc.close();
            expect(reply).to.exist;
            expect(reply).to.be.equal(replyMsg);
            done();
        });
    });

    it('should return a sub id for requests', (done) => {
        let nc = NATS.connect(PORT);
        let initMsg = 'Hello World';
        let replyMsg = 'Hello Back!';
        let expected = 1;
        let received = 0;

        // Add two subscribers. We will only receive a reply from one.
        nc.subscribe('foo', {}, (msg, reply) => {
            nc.publish(reply, replyMsg);
        });

        nc.subscribe('foo', {}, (msg, reply) => {
            nc.publish(reply, replyMsg);
        });

        let sub = nc.request('foo', initMsg, {}, () => {
            nc.flush(function () {
                nc.close();
                expect(received).to.be.equal(expected);
                done();
            });

            received += 1;
            nc.unsubscribe(sub);
        });
    });

    it('should do single partial wildcard subscriptions correctly', (done) => {
        let nc = NATS.connect(PORT);
        let expected = 3;
        let received = 0;
        nc.subscribe('*', {}, () => {
            received += 1;
            if (received === expected) {
                nc.close();
                done();
            }
        });
        nc.publish('foo.baz'); // miss
        nc.publish('foo.baz.foo'); // miss
        nc.publish('foo');
        nc.publish('bar');
        nc.publish('foo.bar.3'); // miss
        nc.publish('baz');
    });

    it('should do partial wildcard subscriptions correctly', (done) => {
        let nc = NATS.connect(PORT);
        let expected = 3;
        let received = 0;
        nc.subscribe('foo.bar.*', {}, () => {
            received += 1;
            if (received === expected) {
                nc.close();
                done();
            }
        });
        nc.publish('foo.baz'); // miss
        nc.publish('foo.baz.foo'); // miss
        nc.publish('foo.bar.1');
        nc.publish('foo.bar.2');
        nc.publish('bar');
        nc.publish('foo.bar.3');
    });

    it('should do full wildcard subscriptions correctly', (done) => {
        let nc = NATS.connect(PORT);
        let expected = 5;
        let received = 0;
        nc.subscribe('foo.>', {}, () => {
            received += 1;
            if (received === expected) {
                nc.close();
                done();
            }
        });
        nc.publish('foo.baz');
        nc.publish('foo.baz.foo');
        nc.publish('foo.bar.1');
        nc.publish('foo.bar.2');
        nc.publish('bar'); // miss
        nc.publish('foo.bar.3');
    });

    it('should pass exact subject to callback', function (done) {
        let nc = NATS.connect(PORT);
        let subject = 'foo.bar.baz';
        nc.subscribe('*.*.*', {}, (msg, reply, subj) => {
            nc.close();
            expect(subj).to.exist;
            expect(subj).to.be.equal(subject);
            done();
        });
        nc.publish(subject);
    });

    it('should do callback after publish is flushed', (done) => {
        let nc = NATS.connect(PORT);
        nc.publish('foo', "", "", () => {
            nc.close();
            done();
        });
    });

    it('should do callback after flush', (done) => {
        let nc = NATS.connect(PORT);
        nc.flush(function () {
            nc.close();
            done();
        });
    });

    it('should handle an unsubscribe after close of connection', (done) => {
        let nc = NATS.connect(PORT);
        let sid = nc.subscribe('foo');
        nc.close();
        nc.unsubscribe(sid);
        done();
    });

    it('should not receive data after unsubscribe call', (done) => {
        let nc = NATS.connect(PORT);
        let received = 0;
        let expected = 1;

        let sid = nc.subscribe('foo', {}, () => {
            nc.unsubscribe(sid);
            received += 1;
        });

        nc.publish('foo');
        nc.publish('foo');
        nc.publish('foo', function () {
            expect(received).to.equal(expected);
            nc.close();
            done();
        });
    });

    it('should pass sid properly to a message callback if requested', (done) => {
        let nc = NATS.connect(PORT);
        let sid = nc.subscribe('foo', {}, (msg, reply, subj, lsid) => {
            expect(lsid).to.equal(sid);
            nc.close();
            done();
        });
        nc.publish('foo');
    });

    it('should parse json messages', (done) => {
        let config = {
            port: PORT,
            json: true
        } as NatsConnectionOptions;
        let nc = NATS.connect(config);
        let jsonMsg = {
            key: true
        };
        nc.subscribe('foo1', {}, (msg) => {
            nc.close();
            expect(msg).to.exist;
            expect(msg).to.have.property('key');
            //@ts-ignore
            expect(msg.key).to.be.true;
            done();
        });
        nc.publish('foo1', jsonMsg);
    });

    it('should parse UTF8 json messages', (done) => {
        let config = {
            port: PORT,
            json: true
        } as NatsConnectionOptions;

        let nc = NATS.connect(config);
        let utf8msg = {
            key: 'CEDILA-Ç'
        };
        nc.subscribe('foo2', {}, (msg) => {
            nc.close();
            expect(msg).to.exist;
            expect(msg).to.have.property('key');
            //@ts-ignore
            expect(msg.key).to.be.equal(utf8msg.key);
            //@ts-ignore
            expect(msg).to.be.eql(utf8msg);
            done();
        });
        nc.publish('foo2', utf8msg);
    });

    it('should validate json messages before publishing', (done) => {
        let config = {
            port: PORT,
            json: true
        } as NatsConnectionOptions;
        let nc = NATS.connect(config);
        let error: Error | null = null;

        try {
            nc.publish('foo3', 'not JSON');
        } catch (e) {
            error = e;
        }
        if (!error) {
            nc.close();
            return done('Should not accept string as message when JSON switch is turned on');
        }

        try {
            //@ts-ignore
            nc.publish('foo3', 1);
        } catch (e) {
            error = e;
        }
        if (!error) {
            nc.close();
            return done('Should not accept number as message when JSON switch is turned on');
        }

        try {
            //@ts-ignore
            nc.publish('foo3', false);
        } catch (e) {
            error = e;
        }
        if (!error) {
            nc.close();
            return done('Should not accept boolean as message when JSON switch is turned on');
        }

        try {
            nc.publish('foo3', []);
        } catch (e) {
            error = e;
        }
        if (!error) {
            nc.close();
            return done('Should not accept array as message when JSON switch is turned on');
        }

        nc.close();
        done();
    });

    function requestOneGetsReply(nc: NATS.Client, done: Function) {
        let initMsg = 'Hello World';
        let replyMsg = 'Hello Back!';

        nc.subscribe('foo', {}, (msg, reply) => {
            expect(msg).to.exist;
            expect(msg).to.be.equal(initMsg);
            expect(reply).to.exist;
            expect(reply).to.match(/_INBOX\.*/);
            nc.publish(reply, replyMsg);
        });

        nc.requestOne('foo', initMsg, {}, 1000, (reply) => {
            expect(reply).to.exist;
            expect(reply).to.be.equal(replyMsg);
            nc.close();
            done();
        });
    }

    it('should do requestone-get-reply', (done) => {
        let nc = NATS.connect(PORT);
        requestOneGetsReply(nc, done);
    });

    it('oldRequestOne should do requestone-get-reply', (done) => {
        let nc = NATS.connect({port: PORT, useOldRequestStyle: true} as NatsConnectionOptions);
        requestOneGetsReply(nc, done);
    });

    function requestOneWillUnsubscribe(nc: NATS.Client, done: Function) {
        const rsub = "x.y.z";
        let count = 0;

        nc.subscribe(rsub, {}, (msg, reply) => {
            expect(reply).to.match(/_INBOX\.*/);
            nc.publish(reply, "y");
            nc.publish(reply, "yy");
            nc.flush();
            setTimeout(function () {
                nc.publish(reply, "z");
                nc.flush();
                nc.close();
                setTimeout(function () {
                    expect(count).to.be.equal(1);
                    nc.close();
                    done();
                }, 1000);
            }, 1500);
        });

        nc.requestOne(rsub, "", {}, 1000, (reply) => {
            expect(reply).to.not.be.instanceof(Error);
            expect(reply).to.exist;
            count++;
        });
    }

    it('should do requestone-will-unsubscribe', (done) => {
        let nc = NATS.connect(PORT);
        requestOneWillUnsubscribe(nc, done);
    }).timeout(3000);


    it('oldRequest: should do requestone-will-unsubscribe', (done) => {
        let nc = NATS.connect({port: PORT, useOldRequestStyle: true} as NatsConnectionOptions);
        requestOneWillUnsubscribe(nc, done);
    }).timeout(3000);

    function requestTimeoutTest(nc: NATS.Client, done: Function) {
        nc.requestOne('a.b.c', '', {}, 1000, (reply) => {
            expect(reply).to.exist;
            expect(reply).to.be.an.instanceof(Error);
            expect(reply).to.have.property('code');
            //@ts-ignore
            expect(reply.code).to.be.equal(NATS.REQ_TIMEOUT);
            nc.close();
            done();
        });
    }

    it('should do requestone-can-timeout', (done) => {
        let nc = NATS.connect(PORT);
        requestTimeoutTest(nc, done);
    });

    it('old request one - should do requestone-can-timeout', (done) => {
        let nc = NATS.connect({port: PORT, useOldRequestStyle: true} as NatsConnectionOptions);
        requestTimeoutTest(nc, done);
    });

    function shouldUnsubscribeWhenRequestOneTimeout(nc: NATS.Client, done: Function) {
        let replies = 0;
        let responses = 0;
        // set a subscriber to respond to the request
        nc.subscribe('a.b.c', {max: 1} as NATS.SubscribeOptions, (msg, reply) => {
            setTimeout(function () {
                nc.publish(reply);
                nc.flush();
                replies++;
            }, 500);
        });

        // request one - we expect a timeout
        nc.requestOne('a.b.c', '', {}, 250, (reply) => {
            expect(reply).to.be.an.instanceof(Error);
            expect(reply).to.have.property('code');
            //@ts-ignore
            expect(reply.code).to.be.equal(NATS.REQ_TIMEOUT);
            if (!reply.hasOwnProperty('code')) {
                responses++;
            }
        });

        // verify reply was sent, but we didn't get it
        setTimeout(function () {
            expect(replies).to.be.equal(1);
            expect(responses).to.be.equal(0);
            nc.close();
            done();
        }, 1000);
    }

    it('should unsubscribe when request one timesout', (done) => {
        let nc = NATS.connect(PORT);
        shouldUnsubscribeWhenRequestOneTimeout(nc, done);
    }).timeout(3000);

    it('old requestOne should unsubscribe when request one timesout', (done) => {
        let nc = NATS.connect({port: PORT, useOldRequestStyle: true} as NatsConnectionOptions);
        shouldUnsubscribeWhenRequestOneTimeout(nc, done);
    }).timeout(3000);

    it('requestone has negative sids', function (done) {
        let nc = NATS.connect(PORT);
        nc.flush(function () {
            let sid = nc.requestOne("121.2.13.4", "", {}, 1000, (r) => {
                expect.fail(r, null, "got message when it shouldn't have");
            });
            expect(sid).to.be.a('number');
            expect(sid).to.be.below(0);

            // this cancel returns the config
            //@ts-ignore
            let conf = nc.respmux.cancelMuxRequest(sid);

            // after cancel it shouldn't exit
            //@ts-ignore
            expect(nc.respmux.requestMap).to.not.have.ownProperty(conf.token);
            nc.close();
            done();
        });
    });

    function paramTranspositions(nc: NATS.Client, done: Function) {
        let all = false;
        let four = false;
        let three = true;
        let count = 0;
        nc.flush(function () {
            nc.requestOne("a", "", {}, 1, function () {
                all = true;
                called();
            });

            nc.requestOne("b", "", {}, 1, function () {
                four = true;
                called();
            });

            nc.requestOne("b", "", {}, 1, function () {
                three = true;
                called();
            });
        });

        function called() {
            count++;
            if (count === 3) {
                expect(all).to.be.true;
                expect(four).to.be.true;
                expect(three).to.be.true;
                nc.close();
                done();
            }
        }
    }

    it('requestOne: optional param transpositions', (done) => {
        let nc = NATS.connect(PORT);
        paramTranspositions(nc, done);
    });

    it('old requestOne: optional param transpositions', (done) => {
        let nc = NATS.connect({port: PORT, useOldRequestStyle: true} as NatsConnectionOptions);
        paramTranspositions(nc, done);
    });
});
