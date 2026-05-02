import { storage } from "../../storage";

export const notificationRepository = {
  // Recipients
  getRecipients: storage.getNotificationRecipients.bind(storage),
  createRecipient: storage.createNotificationRecipient.bind(storage),
  updateRecipient: storage.updateNotificationRecipient.bind(storage),
  deleteRecipient: storage.deleteNotificationRecipient.bind(storage),

  // Weekly push dedup
  hasWeeklyPush: storage.hasWeeklyPushNotification.bind(storage),
  createWeeklyPush: storage.createWeeklyPushNotification.bind(storage),
  clearOldWeeklyPush: storage.clearOldWeeklyPushNotifications.bind(storage),
};
