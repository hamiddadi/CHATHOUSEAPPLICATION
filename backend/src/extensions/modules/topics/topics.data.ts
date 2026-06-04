/**
 * 150+ topic taxonomy aligned with Clubhouse's "Explore Topics" screen.
 * Each top-level category has a slug, emoji, and children. Data is static
 * and may be safely cached at the CDN edge.
 */
export interface Topic {
  slug: string;
  label: string;
  emoji: string;
  children?: Topic[];
}

export const TOPICS: Topic[] = [
  {
    slug: 'tech',
    label: 'Tech',
    emoji: '💻',
    children: [
      { slug: 'ai', label: 'AI & ML', emoji: '🤖' },
      { slug: 'startups', label: 'Startups', emoji: '🚀' },
      { slug: 'web3', label: 'Web3 & Crypto', emoji: '⛓️' },
      { slug: 'product', label: 'Product', emoji: '📱' },
      { slug: 'engineering', label: 'Engineering', emoji: '⚙️' },
      { slug: 'design', label: 'Product Design', emoji: '🎨' },
      { slug: 'data', label: 'Data Science', emoji: '📊' },
      { slug: 'security', label: 'Security', emoji: '🔐' },
      { slug: 'devops', label: 'DevOps', emoji: '☁️' },
      { slug: 'mobile', label: 'Mobile Dev', emoji: '📲' },
    ],
  },
  {
    slug: 'business',
    label: 'Business',
    emoji: '💼',
    children: [
      { slug: 'entrepreneurship', label: 'Entrepreneurship', emoji: '👔' },
      { slug: 'investing', label: 'Investing', emoji: '📈' },
      { slug: 'marketing', label: 'Marketing', emoji: '📣' },
      { slug: 'sales', label: 'Sales', emoji: '💰' },
      { slug: 'leadership', label: 'Leadership', emoji: '🧭' },
      { slug: 'careers', label: 'Careers', emoji: '📚' },
      { slug: 'finance', label: 'Finance', emoji: '🏦' },
      { slug: 'real-estate', label: 'Real Estate', emoji: '🏘️' },
      { slug: 'ecommerce', label: 'E-commerce', emoji: '🛒' },
      { slug: 'consulting', label: 'Consulting', emoji: '🗂️' },
    ],
  },
  {
    slug: 'arts',
    label: 'Arts',
    emoji: '🎨',
    children: [
      { slug: 'painting', label: 'Painting', emoji: '🖼️' },
      { slug: 'photography', label: 'Photography', emoji: '📷' },
      { slug: 'film', label: 'Film & TV', emoji: '🎬' },
      { slug: 'theater', label: 'Theater', emoji: '🎭' },
      { slug: 'fashion', label: 'Fashion', emoji: '👗' },
      { slug: 'literature', label: 'Literature', emoji: '📖' },
      { slug: 'writing', label: 'Writing', emoji: '✍️' },
      { slug: 'poetry', label: 'Poetry', emoji: '📜' },
      { slug: 'comics', label: 'Comics & Manga', emoji: '💥' },
      { slug: 'crafts', label: 'Crafts', emoji: '🧵' },
    ],
  },
  {
    slug: 'music',
    label: 'Music',
    emoji: '🎵',
    children: [
      { slug: 'hip-hop', label: 'Hip-Hop', emoji: '🎤' },
      { slug: 'rnb', label: 'R&B', emoji: '🎙️' },
      { slug: 'rock', label: 'Rock', emoji: '🎸' },
      { slug: 'electronic', label: 'Electronic', emoji: '🎛️' },
      { slug: 'jazz', label: 'Jazz', emoji: '🎷' },
      { slug: 'classical', label: 'Classical', emoji: '🎻' },
      { slug: 'pop', label: 'Pop', emoji: '🎧' },
      { slug: 'producing', label: 'Music Production', emoji: '🎚️' },
      { slug: 'djing', label: 'DJing', emoji: '🎚️' },
      { slug: 'songwriting', label: 'Songwriting', emoji: '🪕' },
    ],
  },
  {
    slug: 'sports',
    label: 'Sports',
    emoji: '⚽',
    children: [
      { slug: 'football', label: 'Football', emoji: '⚽' },
      { slug: 'basketball', label: 'Basketball', emoji: '🏀' },
      { slug: 'tennis', label: 'Tennis', emoji: '🎾' },
      { slug: 'mma', label: 'MMA', emoji: '🥊' },
      { slug: 'running', label: 'Running', emoji: '🏃' },
      { slug: 'cycling', label: 'Cycling', emoji: '🚴' },
      { slug: 'cricket', label: 'Cricket', emoji: '🏏' },
      { slug: 'esports', label: 'Esports', emoji: '🎮' },
      { slug: 'golf', label: 'Golf', emoji: '⛳' },
      { slug: 'fitness', label: 'Fitness', emoji: '💪' },
    ],
  },
  {
    slug: 'wellness',
    label: 'Health & Wellness',
    emoji: '🧘',
    children: [
      { slug: 'meditation', label: 'Meditation', emoji: '🧘' },
      { slug: 'mental-health', label: 'Mental Health', emoji: '🧠' },
      { slug: 'nutrition', label: 'Nutrition', emoji: '🥗' },
      { slug: 'yoga', label: 'Yoga', emoji: '🧘‍♀️' },
      { slug: 'sleep', label: 'Sleep', emoji: '😴' },
      { slug: 'mindfulness', label: 'Mindfulness', emoji: '🌿' },
      { slug: 'biohacking', label: 'Biohacking', emoji: '🧬' },
    ],
  },
  {
    slug: 'science',
    label: 'Science',
    emoji: '🔬',
    children: [
      { slug: 'physics', label: 'Physics', emoji: '⚛️' },
      { slug: 'space', label: 'Space & Astronomy', emoji: '🌌' },
      { slug: 'biology', label: 'Biology', emoji: '🧬' },
      { slug: 'chemistry', label: 'Chemistry', emoji: '⚗️' },
      { slug: 'climate', label: 'Climate', emoji: '🌍' },
      { slug: 'neuroscience', label: 'Neuroscience', emoji: '🧠' },
      { slug: 'medicine', label: 'Medicine', emoji: '⚕️' },
    ],
  },
  {
    slug: 'world',
    label: 'World Affairs',
    emoji: '🌐',
    children: [
      { slug: 'politics', label: 'Politics', emoji: '🏛️' },
      { slug: 'news', label: 'News', emoji: '📰' },
      { slug: 'economics', label: 'Economics', emoji: '💱' },
      { slug: 'climate-action', label: 'Climate Action', emoji: '🌱' },
      { slug: 'human-rights', label: 'Human Rights', emoji: '✊' },
      { slug: 'history', label: 'History', emoji: '🏺' },
      { slug: 'geopolitics', label: 'Geopolitics', emoji: '🗺️' },
    ],
  },
  {
    slug: 'culture',
    label: 'Culture & Identity',
    emoji: '🌍',
    children: [
      { slug: 'languages', label: 'Languages', emoji: '🗣️' },
      { slug: 'diaspora', label: 'Diaspora', emoji: '✈️' },
      { slug: 'spirituality', label: 'Spirituality', emoji: '🕉️' },
      { slug: 'religion', label: 'Religion', emoji: '🛐' },
      { slug: 'lgbtq', label: 'LGBTQ+', emoji: '🏳️‍🌈' },
      { slug: 'food', label: 'Food & Cooking', emoji: '🍳' },
      { slug: 'travel', label: 'Travel', emoji: '🧳' },
    ],
  },
  {
    slug: 'lifestyle',
    label: 'Lifestyle',
    emoji: '✨',
    children: [
      { slug: 'parenting', label: 'Parenting', emoji: '👨‍👩‍👧' },
      { slug: 'relationships', label: 'Relationships', emoji: '💞' },
      { slug: 'dating', label: 'Dating', emoji: '💘' },
      { slug: 'friendship', label: 'Friendship', emoji: '🫶' },
      { slug: 'home', label: 'Home & Decor', emoji: '🛋️' },
      { slug: 'pets', label: 'Pets', emoji: '🐶' },
      { slug: 'gardening', label: 'Gardening', emoji: '🌱' },
    ],
  },
  {
    slug: 'gaming',
    label: 'Gaming',
    emoji: '🎮',
    children: [
      { slug: 'pc-gaming', label: 'PC Gaming', emoji: '🖥️' },
      { slug: 'console', label: 'Console', emoji: '🕹️' },
      { slug: 'mobile-gaming', label: 'Mobile Gaming', emoji: '📱' },
      { slug: 'mmo', label: 'MMORPG', emoji: '🛡️' },
      { slug: 'indie', label: 'Indie Games', emoji: '🎲' },
      { slug: 'streaming', label: 'Streaming', emoji: '🎥' },
    ],
  },
  {
    slug: 'entertainment',
    label: 'Entertainment',
    emoji: '🍿',
    children: [
      { slug: 'celebrities', label: 'Celebrities', emoji: '⭐' },
      { slug: 'reality-tv', label: 'Reality TV', emoji: '📺' },
      { slug: 'standup', label: 'Stand-Up', emoji: '🎤' },
      { slug: 'podcasts', label: 'Podcasts', emoji: '🎧' },
      { slug: 'memes', label: 'Memes', emoji: '😂' },
      { slug: 'awards', label: 'Awards Shows', emoji: '🏆' },
    ],
  },
  {
    slug: 'education',
    label: 'Education',
    emoji: '🎓',
    children: [
      { slug: 'self-improvement', label: 'Self-Improvement', emoji: '📈' },
      { slug: 'language-learning', label: 'Language Learning', emoji: '🗣️' },
      { slug: 'reading-clubs', label: 'Reading Clubs', emoji: '📚' },
      { slug: 'philosophy', label: 'Philosophy', emoji: '🤔' },
      { slug: 'study-groups', label: 'Study Groups', emoji: '📝' },
      { slug: 'teaching', label: 'Teaching', emoji: '👩‍🏫' },
    ],
  },
];

export const FLAT_TOPICS = TOPICS.flatMap(t => [
  { slug: t.slug, label: t.label, emoji: t.emoji, parent: null },
  ...(t.children ?? []).map(c => ({
    slug: c.slug,
    label: c.label,
    emoji: c.emoji,
    parent: t.slug,
  })),
]);
