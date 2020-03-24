import { Sub as natssub } from 'nats'

/**
 * Type returned when a subscribe call resolved. Provides methods to manage the subscription.
 */
export class Sub {
  sub: natssub

  /**
   * @hidden
   */
  constructor(sub: natssub) {
    this.sub = sub
  }

  /**
   * Cancels the subscription after the specified number of messages has been received.
   * If max is not specified, the subscription cancels immediately. A cancelled subscription
   * will not process messages that are inbound but not yet handled.
   * @param max
   * @see [[drain]]
   */
  unsubscribe(max?: number): void {
    this.sub.unsubscribe(max)
  }

  /**
   * Draining a subscription is similar to unsubscribe but inbound pending messages are
   * not discarded. When the last in-flight message is processed, the subscription handler
   * is removed.
   * @return a Promise that resolves when the draining a subscription completes
   * @see [[unsubscribe]]
   */
  drain(): Promise<any> {
    const s = this.sub
    return new Promise<any>((resolve, reject) => {
      s.drain((err) => {
        if (err) {
          reject(err)
        } else {
          resolve(true)
        }
      })
    })
  }

  /**
   * Returns true if the subscription has an associated timeout.
   */
  hasTimeout(): boolean {
    return this.sub.hasTimeout()
  }

  /**
   * Cancels a timeout associated with the subscription
   */
  cancelTimeout(): void {
    this.sub.cancelTimeout()
  }

  /**
   * Sets a timeout on a subscription. The timeout will fire by calling
   * the subscription's callback with an error argument if the expected
   * number of messages (specified via max) has not been received by the
   * subscription before the timer expires. If max is not specified,
   * the subscription times out if no messages are received within the timeout
   * specified.
   *
   * Returns `true` if the subscription was found and the timeout was registered.
   *
   * @param millis
   * @param max - max number of messages
   */
  setTimeout(millis: number, max?: number): boolean {
    return this.sub.setTimeout(millis, max)
  }

  /**
   * Returns the number of messages received by the subscription.
   */
  getReceived(): number {
    return this.sub.getReceived()
  }

  /**
   * Returns the number of messages expected by the subscription.
   * If `0`, the subscription was not found or was auto-cancelled.
   * If `-1`, the subscription didn't specify a count for expected messages.
   */
  getMax(): number {
    return this.sub.getMax()
  }

  /**
   * @return true if the subscription is not found.
   */
  isCancelled(): boolean {
    return this.sub.isCancelled()
  }

  /**
   * @return true if the subscription is draining.
   * @see [[drain]]
   */
  isDraining(): boolean {
    return this.sub.isDraining()
  }

  getID(): number {
    return this.sub.getID()
  }
}
