import admin, { ServiceAccount } from "firebase-admin";
import {
  FirebaseNotificationOptions,
  NotificationChannel,
} from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";

interface FirebaseNotifierConfig {
  serviceAccount: ServiceAccount;
  maxMessagesPerSecond?: number; // Allow users to configure
}

export class FirebaseNotifier implements NotificationChannel {
  private initialized = false;
  private rateLimiter: RateLimiter;

  constructor(private config: FirebaseNotifierConfig) {
    this.initFirebase();
    // Default to high limit if not specified explicitly
    this.rateLimiter = new RateLimiter(
      config.maxMessagesPerSecond || 500,
      1000
    );
  }

  private initFirebase() {
    if (!this.initialized) {
      admin.initializeApp({
        credential: admin.credential.cert(this.config.serviceAccount),
      });
      this.initialized = true;
    }
  }

  async send(
    userIds: string[],
    meta?: FirebaseNotificationOptions[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const messaging = admin.messaging();
    const results: any[] = [];

    // Chunking
    const tokensChunks = this.chunkArray(userIds, 500);

    for (const tokens of tokensChunks) {
      // Assuming rateLimiter.schedule returns a promise
      await this.rateLimiter.schedule(async () => {
        // Use map for async operations within each chunk
        await Promise.all(
          tokens.map(async (userId, index) => {
            const userMeta = meta ? meta[index] : undefined;
            const payload: admin.messaging.MessagingPayload = {
              notification: {
                title: userMeta?.title || "Default Notification",
                body: userMeta?.body || "",
              },
              data: userMeta?.data || {},
            };

            try {
              const response = await messaging.send(
                {
                  token: userId,
                  ...payload,
                },
                userMeta?.dryRun || false
              );

              Logger.log(
                `📨 Firebase notification sent to ${userId}: ${JSON.stringify(
                  response
                )}`
              );
              results.push({
                status: "success",
                recipient: userId,
                response: response,
              });
            } catch (error: any) {
              Logger.error(`❌ Firebase Error (Token: ${userId}):`, error);
              results.push({
                status: "failed",
                recipient: userId,
                error: error?.message,
              });
            }
          })
        );
      });
    }

    return results;
  }

  //   async send(
  //     userIds: string[],
  //     meta?: FirebaseNotificationOptions
  //   ): Promise<
  //     { status: string; recipient: string; response?: any; error?: string }[]
  //   > {
  //     const messaging = admin.messaging();
  //     const payload: admin.messaging.MessagingPayload = {
  //       notification: {
  //         title: meta?.title || "Default Notification",
  //         body: meta?.body || "",
  //       },
  //       data: meta?.data || {},
  //     };

  //     const tokensChunks = this.chunkArray(userIds, 500); // FCM limit: 500 tokens per request
  //     const results: any[] = [];

  //     for (const tokens of tokensChunks) {
  //       await this.rateLimiter.schedule(async () => {
  //         try {
  //           const response = await messaging.sendEachForMulticast(
  //             {
  //               tokens,
  //               ...payload,
  //             },
  //             meta?.dryRun
  //           );

  //           Logger.log(
  //             `📨 Firebase notifications sent: ${response.successCount} succeeded, ${response.failureCount} failed.`
  //           );

  //           response.responses.forEach((res, idx) => {
  //             if (res.success) {
  //               results.push({
  //                 status: "success",
  //                 recipient: tokens[idx],
  //                 response: res,
  //               });
  //             } else {
  //               Logger.error(
  //                 `❌ Firebase Error (Token: ${tokens[idx]}):`,
  //                 res.error
  //               );
  //               results.push({
  //                 status: "failed",
  //                 recipient: tokens[idx],
  //                 error: res.error?.message,
  //               });
  //             }
  //           });
  //         } catch (error: any) {
  //           Logger.error("❌ Firebase Notification Error:", error.message);
  //           results.push({
  //             status: "failed",
  //             recipient: "batch",
  //             error: error.message,
  //           });
  //         }
  //       });
  //     }

  //     return results;
  //   }

  // Utility function for chunking tokens
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
