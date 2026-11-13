export const SESSION_STORAGE_KEY='dice-tour.mqtt-session.v1';
export function readSession(storage){const raw=storage.getItem(SESSION_STORAGE_KEY);if(!raw)return null;const s=JSON.parse(raw);if(!s||s.protocol!==1||!s.identity)throw new Error('本地存档格式无效');return s;}
export function writeSession(storage,session,brokerUrl){const {password,username,...safe}=session;const local={...safe,brokerUrl};storage.setItem(SESSION_STORAGE_KEY,JSON.stringify(local));return local;}
