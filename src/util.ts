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



/**
 * @hidden
 */
export function extend(a: any, ...b: any[]): any {
    for (let i = 0; i < b.length; i++) {
        let o = b[i];
        Object.keys(o).forEach(function (k) {
            a[k] = o[k];
        });
    }
    return a;
}

export function delay(millis: number): Promise<any> {
    return new Promise<any>((resolve) => {
        setTimeout(resolve, millis)
    })
}

/**
 * @hidden
 */
export function shuffle(a: any[]): any[] {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function settle(a: any[]): Promise<any[]> {
    if (Array.isArray(a)) {
        return Promise.resolve(a).then(_settle);
    } else {
        return Promise.reject(new TypeError('argument requires an array of promises'));
    }
}

function _settle(a: any[]): Promise<any> {
    return Promise.all(a.map((p) => {
        return Promise.resolve(p).then(_resolve, _resolve);
    }));
}

function _resolve(r: any): any {
    return r;
}

