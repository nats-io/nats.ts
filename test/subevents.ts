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
import * as nsc from './support/nats_server_control';
import {Server} from './support/nats_server_control';
import {expect} from 'chai'

describe('Subscription Events', () => {

    let PORT = 9422;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });


    it('should generate subscribe events', (done) => {
        let nc = NATS.connect(PORT);
        let subj = 'sub.event';
        nc.on('subscribe', (sid, subject) => {
            expect(sid).to.exist;
            expect(subject).to.exist;
            expect(subject).to.be.equal(subj);
            nc.close();
            done();
        });
        nc.subscribe(subj);
    });

    it('should generate subscribe events with opts', (done) => {
        let nc = NATS.connect(PORT);
        let subj = 'sub.event';
        let queuegroup = 'bar';
        nc.on('subscribe', (sid, subject, opts) => {
            expect(sid).to.exist;
            expect(subject).to.exist;
            expect(subject).to.be.equal(subj);
            expect(opts).to.exist;
            expect(opts).to.haveOwnProperty('queue');
            expect(opts.queue).to.be.equal(queuegroup);
            nc.close();
            done();
        });
        nc.subscribe(subj, {
            queue: queuegroup
        });
    });

    it('should generate unsubscribe events', (done) => {
        let nc = NATS.connect(PORT);
        let subj = 'sub.event';
        nc.on('unsubscribe', (sid, subject) => {
            expect(sid).to.exist;
            expect(subject).to.exist;
            expect(subject).to.be.equal(subj);
            nc.close();
            done();
        });
        let sid = nc.subscribe(subj);
        nc.unsubscribe(sid);
    });

    it('should generate unsubscribe events on auto-unsub', (done) => {
        let nc = NATS.connect(PORT);
        let subj = 'autounsub.event';
        nc.on('unsubscribe', (sid, subject) => {
            expect(sid).to.exist;
            expect(subject).to.exist;
            expect(subject).to.be.equal(subj);
            nc.close();
            done();
        });
        nc.subscribe(subj, {
            max: 1
        });
        nc.publish(subj);
    });

    it('should generate only unsubscribe events on auto-unsub', (done) => {
        let nc = NATS.connect(PORT);
        let subj = 'autounsub.event';
        let eventsReceived = 0;
        let want = 5;

        nc.on('unsubscribe', () => {
            eventsReceived++;
        });
        let sid = nc.subscribe(subj);
        nc.unsubscribe(sid, want);
        for (let i = 0; i < want; i++) {
            nc.publish(subj);
        }
        nc.flush(() => {
            expect(eventsReceived).to.be.equal(1);
            nc.close();
            done();
        });
    });
});
