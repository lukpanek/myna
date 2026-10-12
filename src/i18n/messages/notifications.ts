import { defineMessages } from '../define';

/** Desktop notification texts. */
export default defineMessages({
  cs: {
    newMessage: 'Nová zpráva',
    newMessages: { one: '{count} nová zpráva', few: '{count} nové zprávy', other: '{count} nových zpráv' },
    /** `messages` is the `newMessages` text, `count` the number of chats. */
    newMessagesInChats: { one: '{messages} v {count} chatu', other: '{messages} v {count} chatech' },
  },
  sk: {
    newMessage: 'Nová správa',
    newMessages: { one: '{count} nová správa', few: '{count} nové správy', other: '{count} nových správ' },
    newMessagesInChats: { one: '{messages} v {count} chate', other: '{messages} v {count} chatoch' },
  },
  en: {
    newMessage: 'New message',
    newMessages: { one: '{count} new message', other: '{count} new messages' },
    newMessagesInChats: { one: '{messages} in {count} chat', other: '{messages} in {count} chats' },
  },
});
