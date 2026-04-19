import { MOCK_HOUSES, findHouseById } from '../../../shared/mocks/houses.mock';
import type { House, HousePrivacy, HouseSummary } from '../../../shared/types/domain';

const wait = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

export interface CreateHouseInput {
  name: string;
  description: string;
  privacy: HousePrivacy;
  iconUrl?: string | null;
}

export const houseService = {
  async list(filter: 'mine' | 'discover' = 'mine'): Promise<HouseSummary[]> {
    await wait(250);
    if (filter === 'mine') {
      return MOCK_HOUSES.filter(h => h.isJoinedByMe).map(toSummary);
    }
    return MOCK_HOUSES.filter(h => !h.isJoinedByMe).map(toSummary);
  },

  async get(id: string): Promise<House> {
    await wait(200);
    const house = findHouseById(id);
    if (!house) throw new Error(`House ${id} not found`);
    return house;
  },

  async create(input: CreateHouseInput): Promise<House> {
    await wait(400);
    if (input.name.trim().length < 2) throw new Error('Name too short');
    const template = MOCK_HOUSES[0];
    if (!template) throw new Error('Mock seed missing');
    return {
      ...template,
      id: `h-new-${Date.now()}`,
      name: input.name.trim(),
      description: input.description.trim(),
      privacy: input.privacy,
      iconUrl: input.iconUrl ?? null,
      membersCount: 1,
      liveRoomsCount: 0,
      isJoinedByMe: true,
      members: template.members.slice(0, 1),
      createdAt: new Date().toISOString(),
    };
  },

  async join(houseId: string): Promise<{ joined: true }> {
    await wait(200);
    if (!findHouseById(houseId)) throw new Error(`House ${houseId} not found`);
    return { joined: true };
  },

  async invite(houseId: string, userIds: readonly string[]): Promise<{ sent: number }> {
    await wait(200);
    if (!findHouseById(houseId)) throw new Error(`House ${houseId} not found`);
    return { sent: userIds.length };
  },

  async acceptInvitation(
    houseId: string,
    _inviteToken: string | undefined,
  ): Promise<{ joined: true }> {
    await wait(300);
    if (!findHouseById(houseId)) throw new Error(`House ${houseId} not found`);
    return { joined: true };
  },
};

const toSummary = (h: House): HouseSummary => ({
  id: h.id,
  name: h.name,
  category: h.category,
  categoryEmoji: h.categoryEmoji,
  iconUrl: h.iconUrl,
  membersCount: h.membersCount,
  privacy: h.privacy,
});
