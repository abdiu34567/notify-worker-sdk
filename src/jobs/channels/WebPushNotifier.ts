import webPush, { PushSubscription, RequestOptions } from "web-push";
import { NotificationChannel, WebPush } from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";

interface WebPushNotifierConfig {
  publicKey: string;
  privateKey: string;
  contactEmail: string;
  maxMessagesPerSecond?: number;
}

export class WebPushNotifier implements NotificationChannel {
  private rateLimiter: RateLimiter;

  constructor(private config: WebPushNotifierConfig) {
    webPush.setVapidDetails(
      "mailto:" + this.config.contactEmail,
      this.config.publicKey,
      this.config.privateKey
    );

    this.rateLimiter = new RateLimiter(config.maxMessagesPerSecond || 50, 1000); // Default ~50/sec
  }

  async send(
    userIds: string[],
    meta: WebPush[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const subscriptions: PushSubscription[] = userIds.map((id) =>
      JSON.parse(id)
    );
    const results: any[] = [];
    const maxConcurrentSends = 5; // Limit concurrent Web Push notifications
    let activeSends: Promise<void>[] = [];

    for (let i = 0; i < subscriptions.length; i++) {
      const subscription = subscriptions[i];
      const pushMeta = meta[i] || {};

      const sendTask = this.rateLimiter.schedule(async () => {
        try {
          const pushPayload = JSON.stringify({
            title: pushMeta.title || "Notification",
            body: pushMeta.body,
            data: pushMeta.data || {},
          });

          // Ensure only valid options are passed
          const requestOptions: RequestOptions = {
            TTL: pushMeta.TTL,
            vapidDetails: pushMeta.vapidDetails,
            headers: pushMeta.headers,
          } as RequestOptions;

          const response = await webPush.sendNotification(
            subscription,
            pushPayload,
            requestOptions
          );

          Logger.log(
            `📨 Web Push sent successfully to ${subscription.endpoint}`
          );
          results.push({
            status: "success",
            recipient: subscription.endpoint,
            response,
          });
        } catch (error: any) {
          Logger.error(
            `❌ Web Push Error (Recipient ${subscription.endpoint}):`,
            error.message
          );
          results.push({
            status: "failed",
            recipient: subscription.endpoint,
            error: error.message,
          });
        }
      });

      activeSends.push(sendTask);

      if (activeSends.length >= maxConcurrentSends) {
        await Promise.race(activeSends);
        activeSends = activeSends.filter((task) => !task.finally);
      }
    }

    await Promise.all(activeSends);
    return results;
  }
}
