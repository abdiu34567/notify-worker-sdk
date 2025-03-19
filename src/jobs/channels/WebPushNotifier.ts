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
    const results: {
      status: string;
      recipient: string;
      response?: any;
      error?: string;
    }[] = [];
    const maxConcurrentSends = 5; // Limit concurrent Web Push notifications
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < subscriptions.length; i++) {
      const subscription = subscriptions[i];
      const pushMeta = meta[i] ?? { title: "Notification", body: "", data: {} };

      const task = this.rateLimiter.schedule(async () => {
        try {
          const pushPayload = JSON.stringify({
            title: pushMeta.title || "Notification",
            body: pushMeta.body || "",
            data: pushMeta.data || {},
          });

          // Clean up the request options to remove undefined fields.
          const requestOptions: RequestOptions = JSON.parse(
            JSON.stringify({
              TTL: pushMeta.TTL,
              vapidDetails: pushMeta.vapidDetails,
              headers: pushMeta.headers,
            })
          );

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

      tasks.push(task);

      // When we've reached the concurrency limit, wait for the batch to complete
      if (tasks.length === maxConcurrentSends) {
        await Promise.all(tasks);
        tasks.length = 0; // Clear the tasks array for the next batch
      }
    }

    // Await any remaining tasks that didn't form a full batch
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    return results;
  }
}
