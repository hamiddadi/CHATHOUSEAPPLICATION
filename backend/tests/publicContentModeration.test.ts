import type { ZodTypeAny } from 'zod';
import { requestSchema as clubRequestSchema } from '../src/extensions/modules/clubreq/clubreq.router';
import {
  cancelSchema as cancelEventSchema,
  rescheduleSchema as rescheduleEventSchema,
} from '../src/extensions/modules/events/events.router';
import {
  addSchema as addProfileLinkSchema,
  patchSchema as patchProfileLinkSchema,
} from '../src/extensions/modules/profileLinks/profileLinks.router';
import { registerSchema, loginSchema, resetPasswordSchema } from '../src/modules/auth/auth.schema';
import { sendMessageSchema } from '../src/modules/chat/chat.schema';
import { chatService } from '../src/modules/chat/chat.service';
import { createClubSchema, updateClubSchema } from '../src/modules/clubs/clubs.schema';
import {
  addGroupMembersSchema,
  createGroupSchema,
  renameGroupSchema,
  sendGroupMessageSchema,
} from '../src/modules/groups/groups.schema';
import {
  createRoomSchema,
  inviteToRoomSchema,
  kickSchema,
  sendRoomMessageSchema,
  updateRoomTitleSchema,
} from '../src/modules/rooms/rooms.schema';
import { searchSchema } from '../src/modules/search/search.schema';
import { reportSchema } from '../src/modules/social/social.schema';
import {
  completeOnboardingSchema,
  interestsSchema,
  updateMeSchema,
} from '../src/modules/users/users.schema';
import {
  findPublicContentViolation,
  normalizePublicContent,
  PUBLIC_CONTENT_REJECTION_MESSAGE,
} from '../src/utils/publicContentModeration';

type RejectedSchemaCase = {
  name: string;
  schema: ZodTypeAny;
  input: unknown;
  path: string;
};

const rejectedSchemaCases: RejectedSchemaCase[] = [
  {
    name: 'DM content',
    schema: sendMessageSchema,
    input: { content: 'I will kill you' },
    path: 'content',
  },
  {
    name: 'group chat content',
    schema: sendGroupMessageSchema,
    input: { content: 'I will kill you' },
    path: 'content',
  },
  {
    name: 'room chat content',
    schema: sendRoomMessageSchema,
    input: { content: 'I will kill you' },
    path: 'content',
  },
  {
    name: 'new group title',
    schema: createGroupSchema,
    input: { title: 'I will kill you', memberIds: ['user-1', 'user-2'] },
    path: 'title',
  },
  {
    name: 'renamed group title',
    schema: renameGroupSchema,
    input: { title: 'I will kill you' },
    path: 'title',
  },
  {
    name: 'new room title',
    schema: createRoomSchema,
    input: { title: 'I will kill you' },
    path: 'title',
  },
  {
    name: 'new room description',
    schema: createRoomSchema,
    input: { title: 'Community meetup', description: 'I will kill you' },
    path: 'description',
  },
  {
    name: 'new room topic',
    schema: createRoomSchema,
    input: { title: 'Community meetup', topic: 'I will kill you' },
    path: 'topic',
  },
  {
    name: 'new room topic tag',
    schema: createRoomSchema,
    input: { title: 'Community meetup', topics: ['I will kill you'] },
    path: 'topics.0',
  },
  {
    name: 'updated room title',
    schema: updateRoomTitleSchema,
    input: { title: 'I will kill you' },
    path: 'title',
  },
  {
    name: 'new club name',
    schema: createClubSchema,
    input: { name: 'I will kill you' },
    path: 'name',
  },
  {
    name: 'new club description',
    schema: createClubSchema,
    input: { name: 'Gardeners', description: 'I will kill you' },
    path: 'description',
  },
  {
    name: 'new club rules',
    schema: createClubSchema,
    input: { name: 'Gardeners', rules: 'I will kill you' },
    path: 'rules',
  },
  {
    name: 'new club category',
    schema: createClubSchema,
    input: { name: 'Gardeners', category: 'I will kill you' },
    path: 'category',
  },
  {
    name: 'updated club name',
    schema: updateClubSchema,
    input: { name: 'I will kill you' },
    path: 'name',
  },
  {
    name: 'updated club description',
    schema: updateClubSchema,
    input: { description: 'I will kill you' },
    path: 'description',
  },
  {
    name: 'updated club rules',
    schema: updateClubSchema,
    input: { rules: 'I will kill you' },
    path: 'rules',
  },
  {
    name: 'updated club category',
    schema: updateClubSchema,
    input: { category: 'I will kill you' },
    path: 'category',
  },
  {
    name: 'profile interest',
    schema: interestsSchema,
    input: { interests: ['music', 'travel', 'I will kill you'] },
    path: 'interests.2',
  },
  {
    name: 'onboarding profile interest',
    schema: completeOnboardingSchema,
    input: { interests: ['music', 'travel', 'I will kill you'] },
    path: 'interests.2',
  },
  {
    name: 'event cancellation reason',
    schema: cancelEventSchema,
    input: { reason: 'I will kill you' },
    path: 'reason',
  },
  {
    name: 'rescheduled event title',
    schema: rescheduleEventSchema,
    input: { scheduledFor: '2030-01-01T00:00:00.000Z', title: 'I will kill you' },
    path: 'title',
  },
  {
    name: 'club membership request',
    schema: clubRequestSchema,
    input: { message: 'I will kill you' },
    path: 'message',
  },
  {
    name: 'new profile-link label',
    schema: addProfileLinkSchema,
    input: { label: 'I will kill you', url: 'https://example.com' },
    path: 'label',
  },
  {
    name: 'updated profile-link label',
    schema: patchProfileLinkSchema,
    input: { label: 'I will kill you' },
    path: 'label',
  },
  ...(['displayName', 'firstName', 'lastName', 'bio'] as const).map(field => ({
    name: `updated profile ${field}`,
    schema: updateMeSchema,
    input: { [field]: 'I will kill you' },
    path: field,
  })),
  ...(['displayName', 'firstName', 'lastName', 'bio'] as const).map(field => ({
    name: `onboarding profile ${field}`,
    schema: completeOnboardingSchema,
    input: { [field]: 'I will kill you' },
    path: field,
  })),
  {
    name: 'registration display name',
    schema: registerSchema,
    input: {
      username: 'alice123',
      email: 'alice@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'I will kill you',
    },
    path: 'displayName',
  },
];

describe('public content moderation classifier', () => {
  test('normalizes compatibility Unicode, accents and invisible formatting', () => {
    expect(normalizePublicContent('  HéLLO—ＷＯＲＬＤ\u200B  ')).toBe('hello world');
  });

  test.each([
    ['I will kill you', 'threat_or_incitement'],
    ['Je vais te tuer', 'threat_or_incitement'],
    ['ＫІＬＬ yоurself', 'threat_or_incitement'],
    ['I want to kill myself', 'self_harm'],
    ['Je vais mettre fin à mes jours', 'self_harm'],
    ['n1gg3r', 'explicit_slur'],
    ['b.o.u.g.n.o.u.l.e', 'explicit_slur'],
  ] as const)(
    'classifies blocked text without exposing its matched phrase: %s',
    (text, violation) => {
      expect(findPublicContentViolation(text)).toBe(violation);
    },
  );

  test.each([
    'I could kill for a coffee after this meeting.',
    'A murder mystery book club',
    'Suicide prevention resources save lives.',
    'Retard prévu du train : dix minutes.',
    'A class about queer history',
    'Damn, this bug is frustrating.',
  ])('allows benign text outside the narrow high-confidence rules: %s', text => {
    expect(findPublicContentViolation(text)).toBeNull();
  });
});

describe('public UGC schemas', () => {
  test.each(rejectedSchemaCases)(
    'rejects $name with the generic message',
    ({ schema, input, path }) => {
      const result = schema.safeParse(input);

      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error(`Expected ${path} to be rejected`);
      }

      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: path
              .split('.')
              .map(segment => (/^\d+$/.test(segment) ? Number(segment) : segment)),
            message: PUBLIC_CONTENT_REJECTION_MESSAGE,
          }),
        ]),
      );
    },
  );

  test('continues accepting ordinary public profile, room, club and group text', () => {
    expect(
      updateMeSchema.safeParse({
        displayName: 'Alice Martin',
        firstName: 'Alice',
        lastName: 'Martin',
        bio: 'Coffee, software and community radio.',
      }).success,
    ).toBe(true);
    expect(
      createRoomSchema.safeParse({
        title: 'Evening book club',
        description: 'A respectful discussion about mystery novels.',
        topic: 'Literature',
      }).success,
    ).toBe(true);
    expect(
      createClubSchema.safeParse({
        name: 'City Gardeners',
        description: 'Sharing practical urban gardening advice.',
        rules: 'Be kind and stay on topic.',
      }).success,
    ).toBe(true);
    expect(
      createGroupSchema.safeParse({
        title: 'Weekend planning',
        memberIds: ['user-1', 'user-2'],
      }).success,
    ).toBe(true);
    expect(renameGroupSchema.parse({ title: '   ' })).toEqual({ title: null });
  });

  test('does not moderate secrets, IDs, searches or report/moderation reasons', () => {
    const blockedPhrase = 'I will kill you';

    expect(
      loginSchema.safeParse({
        identifier: 'alice@example.com',
        password: blockedPhrase,
      }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        token: 'a'.repeat(32),
        newPassword: blockedPhrase,
      }).success,
    ).toBe(true);
    expect(addGroupMembersSchema.safeParse({ userIds: [blockedPhrase] }).success).toBe(true);
    expect(inviteToRoomSchema.safeParse({ userIds: [blockedPhrase] }).success).toBe(true);
    expect(searchSchema.safeParse({ q: blockedPhrase }).success).toBe(true);
    expect(kickSchema.safeParse({ userId: 'user-1', reason: blockedPhrase }).success).toBe(true);
    expect(
      reportSchema.safeParse({
        reason: 'other',
        details: blockedPhrase,
      }).success,
    ).toBe(true);
  });
});

describe('non-HTTP publication paths', () => {
  test('rejects a socket-style DM at the service boundary before database access', async () => {
    await expect(
      chatService.send('sender-id', 'receiver-id', { content: 'I will kill you' }),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ['content'],
          message: PUBLIC_CONTENT_REJECTION_MESSAGE,
        }),
      ],
    });
  });
});
