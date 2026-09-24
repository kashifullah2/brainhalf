import type { ProjectEnvironment, ProjectScope } from './types';

export type EmailTemplateKind = 'verify_email' | 'reset_password' | 'magic_link' | 'welcome' | 'order_receipt' | 'contact';
export interface EmailTemplate { kind: EmailTemplateKind; subject: string; text: string }
export interface ManagedSettings {
  appName: string;
  passwordEnabled: boolean;
  magicLinkEnabled: boolean;
  googleEnabled: boolean;
  emailEnabled: boolean;
  welcomeEnabled: boolean;
  googleMode: 'managed' | 'custom';
  emailMode: 'managed' | 'custom';
}
export interface ManagedUser {
  id: string; email: string; name: string; verified: boolean; disabled: boolean;
  role: 'user' | 'admin'; createdAt: number; lastLoginAt: number | null;
}
export interface ProviderReadiness {
  emailReady: boolean; googleReady: boolean; ownerVerified: boolean;
  ownerEmail: string; from: string; googleCallback: string;
}
export type EmailState = 'captured' | 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'failed';
export interface ManagedMessage {
  id: string; kind: EmailTemplateKind; to: string; subject: string; status: EmailState;
  createdAt: number; updatedAt: number; attempts: number; providerId: string | null; error: string | null;
}
export interface EmailPayload { to: string; subject: string; text: string; html: string; replyTo?: string }
export interface ManagedContext extends ProjectScope { environment: ProjectEnvironment; origin: string }
export interface ManagedStatus {
  settings: ManagedSettings; providers: ProviderReadiness; userCount: number;
  mailCounts: Partial<Record<EmailState, number>>; dailyEmailLimit: number;
}

export const MANAGED_DEFAULTS: ManagedSettings = {
  appName: 'My app', passwordEnabled: true, magicLinkEnabled: true,
  googleEnabled: true, emailEnabled: true, welcomeEnabled: false,
  googleMode: 'managed', emailMode: 'managed',
};
