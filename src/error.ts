/*
 * Copyright 2018-2020 The NATS Authors
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

import * as util from 'util';

export enum ErrorCode {
    API_ERROR = 'API_ERROR',
    BAD_AUTHENTICATION = 'BAD_AUTHENTICATION',
    BAD_CREDS = 'BAD_CREDENTIALS',
    BAD_NKEY_SEED = 'BAD_NKEY_CREDENTIALS',
    BAD_JSON = 'BAD_JSON',
    BAD_MSG = 'BAD_MSG',
    BAD_REPLY = 'BAD_REPLY',
    BAD_SUBJECT = 'BAD_SUBJECT',
    CLIENT_CERT_REQ = 'CLIENT_CERT_REQ',
    CONN_CLOSED = 'CONN_CLOSED',
    CONN_DRAINING = 'CONN_DRAINING',
    CONN_ERR = 'CONN_ERR',
    CONN_TIMEOUT = 'CONN_TIMEOUT',
    INVALID_ENCODING = 'INVALID_ENCODING',
    NKEY_OR_JWT_REQ = 'NKEY_OR_JWT_REQ',
    NO_ECHO_NOT_SUPPORTED = 'NO_ECHO_NOT_SUPPORTED',
    NO_SEED_IN_CREDS = 'NO_SEED_IN_CREDS',
    NO_USER_JWT_IN_CREDS = 'NO_USER_JWT_IN_CREDS',
    NON_SECURE_CONN_REQ = 'NON_SECURE_CONN_REQ',
    NONCE_SIGNER_NOTFUNC = 'NONCE_SIGNER_NOT_FUNC',
    REQ_TIMEOUT = 'REQ_TIMEOUT',
    SECURE_CONN_REQ = 'SECURE_CONN_REQ',
    SIGNATURE_REQUIRED = 'SIG_REQ',
    SUB_CLOSED = 'SUB_CLOSED',
    SUB_DRAINING = 'SUB_DRAINING',
    SUB_TIMEOUT = 'SUB_TIMEOUT',

    // emitted by the server
    AUTHORIZATION_VIOLATION = 'AUTHORIZATION_VIOLATION',
    NATS_PROTOCOL_ERR = 'NATS_PROTOCOL_ERR',
    PERMISSIONS_VIOLATION = 'PERMISSIONS_VIOLATION'
}

// Error templates
export const REQ_TIMEOUT_MSG_PREFIX = 'The request timed out for subscription id: ';
export const INVALID_ENCODING_MSG_PREFIX = 'Invalid Encoding:';
export const CONN_ERR_PREFIX = 'Could not connect to server: ';


export class Messages {
    static messages = new Messages();
    messages: { [key: string]: string } = {};

    private constructor() {
        this.messages[ErrorCode.BAD_AUTHENTICATION] = 'User and Token can not both be provided';
        this.messages[ErrorCode.BAD_CREDS] = 'Bad user credentials';
        this.messages[ErrorCode.BAD_NKEY_SEED] = 'Bad nkey credentials';
        this.messages[ErrorCode.BAD_JSON] = 'Message should be a non-circular JSON-serializable value';
        this.messages[ErrorCode.BAD_MSG] = 'Message cannot be a function';
        this.messages[ErrorCode.BAD_REPLY] = 'Reply cannot be a function';
        this.messages[ErrorCode.BAD_SUBJECT] = 'Subject must be supplied';
        this.messages[ErrorCode.CLIENT_CERT_REQ] = 'Server requires a client certificate.';
        this.messages[ErrorCode.CONN_CLOSED] = 'Connection closed';
        this.messages[ErrorCode.CONN_DRAINING] = 'Connection draining';
        this.messages[ErrorCode.CONN_TIMEOUT] = 'Connection timeout';
        this.messages[ErrorCode.NKEY_OR_JWT_REQ] = 'An Nkey or User JWT callback is required.';
        this.messages[ErrorCode.NO_ECHO_NOT_SUPPORTED] = 'No echo option is not supported by this server';
        this.messages[ErrorCode.NO_SEED_IN_CREDS] = 'Cannot locate signing key in credentials';
        this.messages[ErrorCode.NO_USER_JWT_IN_CREDS] = 'Cannot locate user jwt in credentials.';
        this.messages[ErrorCode.NON_SECURE_CONN_REQ] = 'Server does not support a secure connection.';
        this.messages[ErrorCode.NON_SECURE_CONN_REQ] = 'Server does not support a secure connection.';
        this.messages[ErrorCode.NONCE_SIGNER_NOTFUNC] = 'nonce signer is not a function';
        this.messages[ErrorCode.REQ_TIMEOUT] = 'Request timed out.';
        this.messages[ErrorCode.REQ_TIMEOUT] = 'Request timed out.';
        this.messages[ErrorCode.SECURE_CONN_REQ] = 'Server requires a secure connection.';
        this.messages[ErrorCode.SIGNATURE_REQUIRED] = 'Server requires an nkey signature.';
        this.messages[ErrorCode.SUB_CLOSED] = 'Subscription closed';
        this.messages[ErrorCode.SUB_DRAINING] = 'Subscription draining';
        this.messages[ErrorCode.SUB_TIMEOUT] = 'Subscription timed out.';
    }

    static getMessage(s: string): string {
        return Messages.messages.getMessage(s);
    }

    getMessage(s: string): string {
        let v = this.messages[s];
        if (!v) {
            v = s;
        }
        return v;
    }
}


export class NatsError implements Error {
    name: string;
    message: string;
    code: string;
    chainedError?: Error;

    /**
     * @param {String} message
     * @param {String} code
     * @param {Error} [chainedError]
     * @constructor
     *
     * @api private
     */
    constructor(message: string, code: string, chainedError?: Error) {
        Error.captureStackTrace(this, this.constructor);
        this.name = 'NatsError';
        this.message = message;
        this.code = code;
        this.chainedError = chainedError;

        util.inherits(NatsError, Error);
    }

    static errorForCode(code: string, chainedError?: Error): NatsError {
        let m = Messages.getMessage(code);
        return new NatsError(m, code, chainedError);
    }
}
