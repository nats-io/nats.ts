/*
 * Copyright 2019-2020 The NATS Authors
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

import test from 'ava';
import {SC, startServer, stopServer, serverVersion} from './helpers/nats_server_control';
import {connect, ConnectionOptions, ErrorCode} from '../src/nats';
import path from 'path';
import {next} from 'nuid';
import {fromSeed} from 'ts-nkeys';
import {jsonToNatsConf, writeFile} from './helpers/nats_conf_utils';
import {unlinkSync} from 'fs';

//  path for files is __dirname is ts-nats/lib/test
const uSeed = 'SUAIBDPBAUTWCWBKIO6XHQNINK5FWJW4OHLXC3HQ2KFE4PEJUA44CNHTC4';
const uJWT = 'eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJFU1VQS1NSNFhGR0pLN0FHUk5ZRjc0STVQNTZHMkFGWERYQ01CUUdHSklKUEVNUVhMSDJBIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJBQ1pTV0JKNFNZSUxLN1FWREVMTzY0VlgzRUZXQjZDWENQTUVCVUtBMzZNSkpRUlBYR0VFUTJXSiIsInN1YiI6IlVBSDQyVUc2UFY1NTJQNVNXTFdUQlAzSDNTNUJIQVZDTzJJRUtFWFVBTkpYUjc1SjYzUlE1V002IiwidHlwZSI6InVzZXIiLCJuYXRzIjp7InB1YiI6e30sInN1YiI6e319fQ.kCR9Erm9zzux4G6M-V2bp7wKMKgnSNqMBACX05nwePRWQa37aO_yObbhcJWFGYjo1Ix-oepOkoyVLxOJeuD8Bw';
const accountPK = 'ACZSWBJ4SYILK7QVDELO64VX3EFWB6CXCPMEBUKA36MJJQRPXGEEQ2WJ';
const accountJWT = 'eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJXVFdYVDNCT1JWSFNLQkc2T0pIVVdFQ01QRVdBNldZVEhNRzVEWkJBUUo1TUtGU1dHM1FRIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInN1YiI6IkFDWlNXQko0U1lJTEs3UVZERUxPNjRWWDNFRldCNkNYQ1BNRUJVS0EzNk1KSlFSUFhHRUVRMldKIiwidHlwZSI6ImFjY291bnQiLCJuYXRzIjp7ImxpbWl0cyI6eyJzdWJzIjotMSwiY29ubiI6LTEsImltcG9ydHMiOi0xLCJleHBvcnRzIjotMSwiZGF0YSI6LTEsInBheWxvYWQiOi0xLCJ3aWxkY2FyZHMiOnRydWV9fX0.q-E7bBGTU0uoTmM9Vn7WaEHDzCUrqvPDb9mPMQbry_PNzVAjf0RG9vd15lGxW5lu7CuGVqpj4CYKhNDHluIJAg';
const opJWT = 'eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJhdWQiOiJURVNUUyIsImV4cCI6MTg1OTEyMTI3NSwianRpIjoiWE5MWjZYWVBIVE1ESlFSTlFPSFVPSlFHV0NVN01JNVc1SlhDWk5YQllVS0VRVzY3STI1USIsImlhdCI6MTU0Mzc2MTI3NSwiaXNzIjoiT0NBVDMzTVRWVTJWVU9JTUdOR1VOWEo2NkFIMlJMU0RBRjNNVUJDWUFZNVFNSUw2NU5RTTZYUUciLCJuYW1lIjoiU3luYWRpYSBDb21tdW5pY2F0aW9ucyBJbmMuIiwibmJmIjoxNTQzNzYxMjc1LCJzdWIiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInR5cGUiOiJvcGVyYXRvciIsIm5hdHMiOnsic2lnbmluZ19rZXlzIjpbIk9EU0tSN01ZRlFaNU1NQUo2RlBNRUVUQ1RFM1JJSE9GTFRZUEpSTUFWVk40T0xWMllZQU1IQ0FDIiwiT0RTS0FDU1JCV1A1MzdEWkRSVko2NTdKT0lHT1BPUTZLRzdUNEhONk9LNEY2SUVDR1hEQUhOUDIiLCJPRFNLSTM2TFpCNDRPWTVJVkNSNlA1MkZaSlpZTVlXWlZXTlVEVExFWjVUSzJQTjNPRU1SVEFCUiJdfX0.hyfz6E39BMUh0GLzovFfk3wT4OfualftjdJ_eYkLfPvu5tZubYQ_Pn9oFYGCV_6yKy3KMGhWGUCyCdHaPhalBw';
const confdir = path.join(__dirname, '..', '..', 'test', 'configs');


test.before(async (t) => {
    if (serverVersion()[0] < 2) {
        return;
    }

    let dir = (process.env.TRAVIS) ? process.env.TRAVIS_BUILD_DIR : process.env.TMPDIR;
    //@ts-ignore
    let operatorJwtPath = path.join(dir, next() + '.jwt');
    writeFile(operatorJwtPath, opJWT);

    let conf = {
        operator: operatorJwtPath,
        resolver: 'MEMORY',
        resolver_preload: {}
    };
    //@ts-ignore
    conf.resolver_preload[accountPK] = accountJWT;

    //@ts-ignore
    let confPath = path.join(dir, next() + '.conf');
    writeFile(confPath, jsonToNatsConf(conf));

    let server = await startServer(['-c', confPath]);
    t.context = {server: server, confPath: confPath, opJWT: operatorJwtPath};
});

test.after.always((t) => {
    if (serverVersion()[0] < 2) {
        return;
    }
    stopServer((t.context as SC).server);
    //@ts-ignore
    unlinkSync(t.context.confPath);
    //@ts-ignore
    unlinkSync(t.context.opJWT);
});

test('error when no nonceSigner callback is defined', async (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion());
        return;
    }
    t.plan(1);
    const sc = t.context as SC;
    return connect({url: sc.server.nats} as ConnectionOptions)
      .then((nc) => {
          t.fail('should have failed to connect')
          nc.close()
      })
      .catch((err) => {
          t.is(err?.code, ErrorCode.SIGNATURE_REQUIRED)
      })
});

test('error if nonceSigner is not function', async (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion());
        return;
    }
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore - ts requires function
    let opts = {url: sc.server.nats, nonceSigner: 'BAD'} as ConnectionOptions;
    return connect(opts)
      .then((nc) => {
          t.fail('should have failed to connect')
          nc.close()
      })
      .catch((err) => {
          t.is(err?.code, ErrorCode.SIGCB_NOTFUNC)
      })
});

test('error if no nkey or userJWT', async (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion());
        return;
    }
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore
    return connect({url: sc.server.nats, nonceSigner: function () {}} as ConnectionOptions)
      .then((nc) => {
          t.fail('should have not connected')
          nc.close()
      })
      .catch((err) => {
          t.is(err?.code, ErrorCode.NKEY_OR_JWT_REQ)
      })
});

test('connects with userJWT and nonceSigner', (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion())
        return
    }

    t.plan(1)
    let sc = t.context as SC
    return connect({
        url: sc.server.nats,
        userJWT: uJWT,
        nonceSigner: function (nonce: string): Buffer {
            let sk = fromSeed(Buffer.from(uSeed));
            return sk.sign(Buffer.from(nonce));
        }
    } as ConnectionOptions)
      .then((nc) => {
          t.pass()
          nc.close()
      })
});

test('connects with userJWT function', async (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion());
        return;
    }

    t.plan(1);
    const sc = t.context as SC;
    return connect({
        url: sc.server.nats,
        userJWT: function () {
            return uJWT;
        },
        nonceSigner: function (nonce: string): Buffer {
            let sk = fromSeed(Buffer.from(uSeed));
            return sk.sign(Buffer.from(nonce));
        }
    } as ConnectionOptions)
      .then((nc) => {
          t.pass();
          nc.close();
      })

});

test('connects with creds file', async (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion());
        return;
    }

    t.plan(1);
    const sc = t.context as SC;
    //@ts-ignore
    return connect({
        url: sc.server.nats,
        userCreds: path.join(confdir, 'nkeys', 'test.creds')
    } as ConnectionOptions)
      .then((nc) => {
          t.pass()
          nc.close()
      })
});

test('fails connects with bad creds file', async (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion());
        return;
    }
    t.plan(1);
    let sc = t.context as SC;
    return connect({
        url: sc.server.nats,
        userCreds: path.join(confdir, 'nkeys', 'test.txt')
    } as ConnectionOptions)
      .then((nc) => {
          t.fail('should have not connected')
          nc.close()
      })
      .catch((err) => {
          t.is(err?.code, ErrorCode.BAD_CREDS)
      })
});
