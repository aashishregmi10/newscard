/**
 * The demonstration shorts.
 *
 * Same rule as the written corpus: publishers are invented, no real named
 * individual appears, and nothing states a checkable fact about a real
 * institution. The footage underneath is real and CC-licensed, and it is
 * credited to its actual photographer — the caption is ours, the pictures are
 * theirs, and both are labelled as what they are.
 *
 * `searchQuery` drives the Wikimedia Commons video search. It has to be
 * something people actually film: "Kathmandu street" returns footage,
 * "municipal policy" returns nothing.
 *
 * `seconds` is the trim length. Kept between fifteen and twenty-five: long
 * enough to be a story, short enough that the low rendition costs about a
 * megabyte, which is what makes a video tab usable on a metered plan.
 */

export interface DemoVideo {
  slug: string;
  language: 'ne' | 'en';
  category: string;
  source: string;
  title: string;
  caption: string;
  seconds: number;
  searchQuery: string;
  minutesAgo: number;
}

export const DEMO_VIDEOS: DemoVideo[] = [
  {
    slug: 'short-ne-kathmandu-street-morning',
    language: 'ne',
    category: 'nepal',
    source: 'namuna-khabar',
    title: 'काठमाडौंको बिहानी सडक',
    caption:
      'सहरका मुख्य सडकमा बिहानको व्यस्तता। ट्राफिक व्यवस्थापनका लागि नयाँ समयतालिका परीक्षण गरिँदै रहेको सम्बन्धित कार्यालयले जनाएको छ।',
    seconds: 20,
    searchQuery: 'Kathmandu street traffic',
    minutesAgo: 22,
  },
  {
    slug: 'short-ne-mountain-trail-season',
    language: 'ne',
    category: 'sports',
    source: 'namuna-khel',
    title: 'पदमार्गमा मौसमी चहलपहल',
    caption:
      'शरद मौसमसँगै पदमार्गमा चहलपहल बढेको छ। सूचना पाटी र सुरक्षा चिन्ह अद्यावधिक गर्ने काम भइरहेको आयोजकहरूले बताएका छन्।',
    seconds: 18,
    searchQuery: 'Nepal trekking mountain trail',
    minutesAgo: 48,
  },
  {
    slug: 'short-en-himalaya-aerial',
    language: 'en',
    category: 'world',
    source: 'sample-post',
    title: 'The range from the air',
    caption:
      'Aerial footage of the high Himalaya. A glacier monitoring study released preliminary findings this month comparing satellite imagery against ground measurements.',
    seconds: 20,
    searchQuery: 'Himalaya mountain Nepal',
    minutesAgo: 71,
  },
  {
    slug: 'short-ne-festival-crowd',
    language: 'ne',
    category: 'nepal',
    source: 'namuna-samachar',
    title: 'चाडपर्वको रौनक',
    caption:
      'पर्वका अवसरमा सहरका प्रमुख क्षेत्रमा भीडभाड बढेको छ। सुरक्षा र सरसफाइका लागि थप जनशक्ति परिचालन गरिएको जनाइएको छ।',
    seconds: 22,
    searchQuery: 'Nepal festival',
    minutesAgo: 96,
  },
  {
    slug: 'short-en-market-trade-day',
    language: 'en',
    category: 'business',
    source: 'sample-post',
    title: 'Market day, early hours',
    caption:
      'Wholesale trading before dawn. Growers said a newly added cold storage facility has let produce be held longer before it reaches the market.',
    seconds: 18,
    searchQuery: 'Nepal market',
    minutesAgo: 124,
  },
  {
    slug: 'short-ne-river-monsoon-flow',
    language: 'ne',
    category: 'nepal',
    source: 'namuna-khabar',
    title: 'नदीको बहाव बढ्दो',
    caption:
      'वर्षापछि नदीको बहाव बढेको छ। तटीय क्षेत्रका बासिन्दालाई सतर्क रहन र आधिकारिक सूचना पछ्याउन आग्रह गरिएको छ।',
    seconds: 16,
    searchQuery: 'Nepal river',
    minutesAgo: 168,
  },
  {
    slug: 'short-en-village-power-lines',
    language: 'en',
    category: 'tech',
    source: 'sample-tech',
    title: 'Power reaches the ridge',
    caption:
      'Distribution work in a hill settlement. A solar microgrid now supplies an irrigation pump and a community building, with local technicians trained to maintain it.',
    seconds: 18,
    searchQuery: 'Nepal village',
    minutesAgo: 205,
  },
  {
    slug: 'short-ne-temple-restoration-work',
    language: 'ne',
    category: 'nepal',
    source: 'namuna-samachar',
    title: 'सम्पदा मर्मतको काम',
    caption:
      'परम्परागत सीप प्रयोग गरी काठ र इँटाको काम भइरहेको छ। काम सम्पन्न भएपछि क्षेत्र आगन्तुकका लागि पुनः खुला हुनेछ।',
    seconds: 20,
    searchQuery: 'Kathmandu temple',
    minutesAgo: 260,
  },
];
