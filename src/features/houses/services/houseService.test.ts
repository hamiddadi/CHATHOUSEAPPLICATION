import { apiClient } from '../../../shared/services/api/apiClient';
import { houseService, type CreateHouseInput } from './houseService';

jest.mock('../../../shared/services/api/apiClient', () => ({
  apiClient: { post: jest.fn() },
}));

const post = apiClient.post as jest.Mock;

describe('houseService.create', () => {
  beforeEach(() => post.mockReset());

  it('forwards the caller-owned idempotency key and normalized payload', async () => {
    post.mockResolvedValue({ data: { data: { id: 'house-1' } } });
    const input: CreateHouseInput = {
      name: '  My House  ',
      description: '  A description  ',
      rules: '  Be kind  ',
      privacy: 'social',
      iconUrl: null,
    };

    await houseService.create(input, 'rn-house-create-contract-123');

    expect(post).toHaveBeenCalledWith(
      '/clubs',
      {
        name: 'My House',
        description: 'A description',
        rules: 'Be kind',
        privacy: 'SOCIAL',
        iconUrl: undefined,
      },
      { headers: { 'Idempotency-Key': 'rn-house-create-contract-123' } },
    );
  });
});
