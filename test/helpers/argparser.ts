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

export interface Flags {
  server?: string;
  subject: string;
  payload: any;
  options: { [key: string]: string };
}

export function parseFlags(args: string[], usage: ()=>void, flags: string[]): Flags {
  const p = new ArgParser(args, usage, flags)
  return p.parseFlags()
}

class ArgParser {
  args: string[]
  usage: () => void
  flags?: string[]

  constructor(args: string[], usage: ()=>void, flags: string[]) {
    this.args = args
    this.usage = usage
    this.flags = flags
  }

  getOpt(flag: string): string | undefined {
    const si = this.args.indexOf(flag)
    if (si !== -1) {
      const v = this.args[si + 1]
      this.args.splice(si, 2)
      return v
    }
    return undefined
  }

  parseFlags(): Flags {
    const opts = {} as Flags
    opts.server = this.getOpt('-s')

    if (this.flags) {
      opts.options = {} as { [key: string]: string }
      this.flags.forEach((f) => {
        const v = this.getOpt('-' + f)
        if (v) {
          opts.options[f] = v
        }
      })
    }

    // should have one or two elements left
    if (this.args.length < 1) {
      this.usage()
    }
    opts.subject = this.args[0] || ''
    opts.payload = this.args[1] || ''

    return opts
  }
}

