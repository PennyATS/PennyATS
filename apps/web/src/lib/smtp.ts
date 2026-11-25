import nodemailer from "nodemailer";
import { isEmail } from "./validation";

export type OutboundMessage = { to: string; subject: string; text: string; html?: string; messageId?: string };

export function smtpConfigured(): boolean {
  const port = Number(process.env.SMTP_PORT ?? 587);
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM && isEmail(process.env.SMTP_FROM) &&
    Number.isInteger(port) && port > 0 && port <= 65535 &&
    Boolean(process.env.SMTP_USER) === Boolean(process.env.SMTP_PASSWORD));
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function smtpTransport() {
  if (!smtpConfigured()) throw new Error("SMTP is not configured.");
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    requireTLS: Number(process.env.SMTP_PORT ?? 587) !== 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transport;
}

export async function verifySmtp(): Promise<void> {
  await smtpTransport().verify();
}

export async function sendSmtp(message: OutboundMessage): Promise<string> {
  if (!isEmail(message.to) || !message.subject.trim() || !message.text.trim()) {
    throw new Error("A valid recipient, subject, and body are required.");
  }
  const sent = await smtpTransport().sendMail({
    from: process.env.SMTP_FROM, to: message.to, subject: message.subject,
    text: message.text, html: message.html, messageId: message.messageId,
  });
  if (!sent.accepted.includes(message.to)) throw new Error("SMTP did not accept the recipient.");
  return sent.messageId;
}
