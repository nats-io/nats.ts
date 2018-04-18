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
import * as u from './support/nats_conf_utils';
import {expect} from 'chai'


describe('NATS Conf Utils', () => {
    it('test serializing simple', () => {
        let x = {
            test: 'one'
        };
        let y = u.jsonToYaml(x);

        let buf = y.split('\n');
        buf.forEach(function (e, i) {
            buf[i] = e.trim();
        });

        let z = buf.join(' ');
        expect(z).to.be.equal("test: one");
    });

    it('test serializing nested', () => {
        let x = {
            a: 'one',
            b: {
                a: 'two'
            }
        };
        let y = u.jsonToYaml(x);

        let buf = y.split('\n');
        buf.forEach(function (e, i) {
            buf[i] = e.trim();
        });

        let z = buf.join(' ');
        expect(z).to.be.equal("a: one b { a: two }");
    });

    it('test serializing array', () => {
        let x = {
            a: 'one',
            b: ['a', 'b', 'c']
        };
        let y = u.jsonToYaml(x);

        let buf = y.split('\n');
        buf.forEach(function (e, i) {
            buf[i] = e.trim();
        });

        let z = buf.join(' ');
        expect(z).to.be.equal("a: one b [ a b c ]");
    });

    it('test serializing array objs', () => {
        let x = {
            a: 'one',
            b: [{
                a: 'a'
            }, {
                b: 'b'
            }, {
                c: 'c'
            }]
        };
        let y = u.jsonToYaml(x);
        let buf = y.split('\n');
        buf.forEach(function (e, i) {
            buf[i] = e.trim();
        });

        let z = buf.join(' ');
        expect(z).to.be.equal("a: one b [ { a: a } { b: b } { c: c } ]");
    });

    it('test serializing array arrays', () => {
        let x = {
            a: 'one',
            b: [{
                a: 'a',
                b: ['b', 'c']
            }, {
                b: 'b'
            }, {
                c: 'c'
            }]
        };
        let y = u.jsonToYaml(x);
        let buf = y.split('\n');
        buf.forEach(function (e, i) {
            buf[i] = e.trim();
        });

        let z = buf.join(' ');
        expect(z).to.be.equal("a: one b [ { a: a b [ b c ] } { b: b } { c: c } ]");
    });
});
