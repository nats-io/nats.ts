/*
 * Copyright 2013-2018 The NATS Authors
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
 */

import * as NATS from '../src/nats';
import {NatsConnectionOptions} from '../src/nats';
import * as nsc from './support/nats_server_control';
import {Server} from './support/nats_server_control';
import {expect} from 'chai'
import {NatsError} from "../src/error";
import {FlushCallback} from "../src/nats";

describe('Errors', () => {

    let PORT = 1491;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should throw errors on connect', (done) => {
        expect(() => {
            NATS.connect({
                'url': 'nats://localhost:' + PORT,
                'token': 'token1',
                'user': 'foo'
            } as NatsConnectionOptions);
        }).to.throw(Error);
        done();
    });

    it('should throw errors on publish', (done) => {
        let nc = NATS.connect(PORT);
        // No subject
        expect(() => {
            //@ts-ignore
            nc.publish();
        }).to.throw(Error);
        // bad args
        expect(() => {
            nc.publish('foo', () => {
            }, 'bar');
        }).to.throw(Error);
        expect(() => {
            //@ts-ignore
            nc.publish('foo', 'bar', () => {
            }, 'bar');
        }).to.throw(Error);
        // closed
        nc.close();
        expect(() => {
            nc.publish('foo');
        }).to.throw(Error);
        done();
    });

    it('should throw errors on flush', (done) => {
        let nc = NATS.connect(PORT);
        nc.close();
        expect(() => {
            nc.flush();
        }).to.throw(Error);
        done();
    });

    it('should pass errors on publish with callbacks', (done) => {
        let nc = NATS.connect(PORT);
        let expectedErrors = 4;
        let received = 0;

        let cb = function (err: Error) {
            expect(err).to.exist;
            if (++received === expectedErrors) {
                done();
            }
        } as FlushCallback;

        // No subject
        //@ts-ignore
        nc.publish(cb);
        // bad args
        nc.publish('foo', function () {
        }, 'bar', cb);
        //@ts-ignore
        nc.publish('foo', 'bar', () => {
        }, cb);

        // closed will still throw since we remove event listeners.
        nc.close();
        nc.publish('foo', cb);
    });

    it('should throw errors on subscribe', (done) => {
        let nc = NATS.connect(PORT);
        nc.close();
        // Closed
        expect(() => {
            nc.subscribe('foo');
        }).to.throw(Error);
        done();
    });

    it('NatsErrors have code', () => {
        let err = new NatsError("hello", "helloid");
        expect(err.message).to.be.equal('hello');
        expect(err.code).to.be.equal('helloid');
    });

    it('NatsErrors can chain an error', () => {
        let srcErr = new Error('foo');
        let err = new NatsError("hello", "helloid", srcErr);
        expect(err.message).to.be.equal('hello');
        expect(err.code).to.be.equal('helloid');
        expect(err.name).to.be.equal('NatsError');
        expect(err.chainedError).to.be.eql(srcErr);
    });

});
