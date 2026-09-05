/**
 * The seed corpus.
 *
 * EVERY story and publisher below is INVENTED, and the source names are
 * deliberately fictional ("नमुना खबर", "Sample Post") rather than real Nepali
 * outlets. Attributing made-up articles to a real publisher would create fake
 * records — the exact thing this product exists not to do.
 *
 * Bilingual on purpose: an English-only corpus lets Devanagari layout and
 * grapheme-counting bugs survive all the way to a real device.
 */

export interface SeedStory {
  slug: string;
  language: 'ne' | 'en';
  category: string;
  source: string;
  headline: string;
  summary: string;
  pullQuote: string | null;
  author: string | null;
  minutesAgo: number;
  /** Stories sharing a clusterKey are one event from several outlets. */
  clusterKey?: string;
  originatingAgency?: string;
  /** A minority of stories have no image — the card must handle that (Ch. 7.2.1). */
  noImage?: boolean;
}

export const STORIES: SeedStory[] = [
  // ── one wire story carried by three outlets ─────────────────────────────
  {
    slug: 'relief-fund-first-tranche-ne-khabar', language: 'ne', category: 'nepal',
    source: 'namuna-khabar', clusterKey: 'relief', originatingAgency: 'Sample News Agency',
    headline: 'बाढी प्रभावित जिल्लामा राहत कोष जारी',
    summary: 'सरकारले बाढी प्रभावित जिल्लाका लागि राहत कोषको पहिलो किस्ता जारी गरेको छ। कोषबाट तीन जिल्लामा अर्को हप्तादेखि वितरण सुरु हुने अधिकारीहरूले जनाएका छन्। क्षतिको विस्तृत विवरण संकलन भइरहेको र आवश्यक परे थप रकम निकासा गरिने पनि उनीहरूले बताएका छन्।',
    pullQuote: 'वितरण अर्को हप्तादेखि सुरु हुने', author: 'र. श्रेष्ठ', minutesAgo: 35,
  },
  {
    slug: 'relief-fund-first-tranche-ne-samachar', language: 'ne', category: 'nepal',
    source: 'namuna-samachar', clusterKey: 'relief', originatingAgency: 'Sample News Agency',
    headline: 'राहत कोषको पहिलो किस्ता निकासा',
    summary: 'बाढी प्रभावित जिल्लाका लागि राहत कोषको पहिलो किस्ता निकासा भएको छ। तीन जिल्लामा अर्को हप्तादेखि वितरण सुरु हुनेछ। सम्बन्धित निकायले क्षतिको विवरण संकलन गरिरहेको र थप सहयोगका लागि समन्वय भइरहेको जनाएको छ।',
    pullQuote: null, author: null, minutesAgo: 41,
  },
  {
    slug: 'relief-fund-first-tranche-en-post', language: 'en', category: 'nepal',
    source: 'sample-post', clusterKey: 'relief', originatingAgency: 'Sample News Agency',
    headline: 'First tranche of flood relief fund released',
    summary: 'The government has released the first tranche of a relief fund for flood-affected districts. Distribution in three districts begins next week, officials said. A detailed damage assessment is still being compiled and further funds may be released if the scale of the damage requires it.',
    pullQuote: 'Distribution begins next week', author: 'A. Thapa', minutesAgo: 48,
  },

  // ── standalone stories ──────────────────────────────────────────────────
  {
    slug: 'power-tariff-review-deferred', language: 'en', category: 'business', source: 'sample-post',
    headline: 'Power tariff review deferred to next quarter',
    summary: 'The electricity regulator has deferred its scheduled tariff review to the next quarter, citing incomplete data from distribution utilities. Consumer groups had asked for a reduction in the domestic slab. The regulator said existing rates remain in force until a revised schedule is published.',
    pullQuote: 'Existing rates remain in force', author: 'A. Thapa', minutesAgo: 95,
  },
  {
    slug: 'university-exam-schedule-published', language: 'ne', category: 'nepal', source: 'namuna-khabar',
    headline: 'विश्वविद्यालयको परीक्षा तालिका सार्वजनिक',
    summary: 'विश्वविद्यालयले स्नातक तहको परीक्षा तालिका सार्वजनिक गरेको छ। परीक्षा अर्को महिनाको दोस्रो हप्ताबाट सुरु हुनेछ। परीक्षा केन्द्र र प्रवेशपत्र वितरणसम्बन्धी सूचना छुट्टै प्रकाशित गरिने विश्वविद्यालयले जनाएको छ।',
    pullQuote: null, author: null, minutesAgo: 190, noImage: true,
  },
  {
    slug: 'regional-cricket-final-today', language: 'ne', category: 'sports', source: 'namuna-khel',
    headline: 'क्षेत्रीय क्रिकेट प्रतियोगिताको फाइनल आज',
    summary: 'क्षेत्रीय क्रिकेट प्रतियोगिताको फाइनल खेल आज हुँदैछ। दुवै टोली यसअघिको भिडन्तमा बराबरीमा रहेका थिए। खेल दिउँसो सुरु हुने र विजेता टोलीले राष्ट्रिय प्रतियोगितामा प्रत्यक्ष प्रवेश पाउने आयोजकले जनाएका छन्।',
    pullQuote: 'विजेताले राष्ट्रिय प्रतियोगितामा प्रत्यक्ष प्रवेश', author: 'स. गुरुङ', minutesAgo: 20,
  },
  {
    slug: 'fibre-rollout-three-municipalities', language: 'en', category: 'tech', source: 'sample-tech',
    headline: 'Fibre rollout reaches three more municipalities',
    summary: 'A fibre broadband rollout has reached three additional municipalities this month, according to the operator. Connections are being offered at introductory rates for the first six months. Coverage in surrounding rural wards is expected to follow, though no date has been given for that phase.',
    pullQuote: 'Rural wards to follow, no date given', author: 'D. Karki', minutesAgo: 300,
  },
  {
    slug: 'local-budget-session-opens', language: 'ne', category: 'politics', source: 'namuna-samachar',
    headline: 'स्थानीय तहको बजेट अधिवेशन सुरु',
    summary: 'स्थानीय तहको बजेट अधिवेशन सुरु भएको छ। आगामी आर्थिक वर्षको नीति तथा कार्यक्रम प्रस्तुत गरिएको छ। पूर्वाधार र शिक्षामा बढी रकम विनियोजन प्रस्ताव गरिएको जनप्रतिनिधिहरूले बताएका छन्।',
    pullQuote: 'पूर्वाधार र शिक्षामा बढी विनियोजन', author: 'ब. अधिकारी', minutesAgo: 420,
  },
  {
    slug: 'regional-trade-talks-resume', language: 'en', category: 'world', source: 'sample-post',
    headline: 'Regional trade talks resume after two-month pause',
    summary: 'Regional trade talks resumed this week after a two-month pause, with negotiators focusing on customs procedures and transit arrangements. No agreement was announced. A further round is expected before the end of the quarter, according to a joint statement issued afterwards.',
    pullQuote: 'No agreement announced', author: 'M. Rai', minutesAgo: 700,
  },
  {
    slug: 'tb-control-programme-expanded', language: 'ne', category: 'nepal', source: 'namuna-khabar',
    headline: 'क्षयरोग नियन्त्रण कार्यक्रम विस्तार',
    summary: 'स्वास्थ्य कार्यालयले क्षयरोग नियन्त्रण कार्यक्रम थप स्वास्थ्य चौकीमा विस्तार गरेको छ। निःशुल्क परीक्षण र औषधि उपलब्ध गराइने जनाइएको छ। चेतना अभिवृद्धिका लागि स्थानीय तहसँग समन्वय गरिने पनि कार्यालयले उल्लेख गरेको छ।',
    pullQuote: 'निःशुल्क परीक्षण र औषधि', author: null, minutesAgo: 1500,
  },
  {
    slug: 'trekking-permits-rise-autumn', language: 'en', category: 'business', source: 'sample-post',
    headline: 'Trekking permits rise ahead of autumn season',
    summary: 'Trekking permit issuance rose ahead of the autumn season compared with the same period last year, according to figures released this week. Operators reported stronger advance bookings on two main routes. Officials cautioned the figures cover permits issued, not arrivals recorded.',
    pullQuote: 'Permits issued, not arrivals recorded', author: 'M. Rai', minutesAgo: 2600,
  },
  {
    slug: 'road-widening-deadline-extended', language: 'ne', category: 'nepal', source: 'namuna-samachar',
    headline: 'सडक विस्तार आयोजनाको म्याद थप',
    summary: 'सडक विस्तार आयोजनाको म्याद थप गरिएको छ। वर्षाका कारण काम प्रभावित भएको र मुआब्जा वितरण बाँकी रहेको आयोजना कार्यालयले जनाएको छ। नयाँ समयसीमाभित्र काम सम्पन्न गर्ने प्रतिबद्धता ठेकेदार कम्पनीले व्यक्त गरेको छ।',
    pullQuote: null, author: 'ब. अधिकारी', minutesAgo: 4400,
  },

  // ── additional stories, added for a fuller feed ─────────────────────────
  {
    slug: 'digital-payment-volume-grows', language: 'en', category: 'business', source: 'sample-tech',
    headline: 'Digital payment volumes grow across retail sector',
    summary: 'Digital payment volumes rose across the retail sector last quarter, with wallet transactions accounting for the largest share. Smaller merchants reported faster settlement as the main reason for adopting them. Cash remains dominant outside urban centres, the report noted.',
    pullQuote: 'Cash still dominant outside cities', author: 'D. Karki', minutesAgo: 140,
  },
  {
    slug: 'school-nutrition-programme-review', language: 'ne', category: 'nepal', source: 'namuna-khabar',
    headline: 'विद्यालय पोषण कार्यक्रमको समीक्षा',
    summary: 'विद्यालय पोषण कार्यक्रमको वार्षिक समीक्षा सम्पन्न भएको छ। कार्यक्रमबाट उपस्थिति दरमा सुधार आएको प्रतिवेदनमा उल्लेख छ। आगामी वर्ष थप विद्यालयमा कार्यक्रम विस्तार गर्ने योजना रहेको जनाइएको छ।',
    pullQuote: 'उपस्थिति दरमा सुधार', author: null, minutesAgo: 260,
  },
  {
    slug: 'monsoon-outlook-revised', language: 'en', category: 'nepal', source: 'sample-post',
    headline: 'Monsoon outlook revised for the remainder of the season',
    summary: 'The meteorological office has revised its monsoon outlook for the remainder of the season, projecting above-average rainfall in the eastern belt. Districts have been advised to review landslide preparedness. The revision follows two weeks of heavier than expected rainfall.',
    pullQuote: 'Districts advised to review preparedness', author: 'A. Thapa', minutesAgo: 75,
  },
  {
    slug: 'archery-team-selection-announced', language: 'ne', category: 'sports', source: 'namuna-khel',
    headline: 'तीरन्दाजी टोलीको छनोट घोषणा',
    summary: 'आगामी क्षेत्रीय प्रतियोगिताका लागि तीरन्दाजी टोलीको छनोट घोषणा गरिएको छ। छनोटमा परेका खेलाडीहरूको तयारी अर्को हप्ताबाट सुरु हुनेछ। प्रशिक्षण शिविर राजधानीमा सञ्चालन गरिने संघले जनाएको छ।',
    pullQuote: null, author: 'स. गुरुङ', minutesAgo: 520,
  },
  {
    slug: 'municipal-waste-plan-published', language: 'ne', category: 'politics', source: 'namuna-samachar',
    headline: 'नगरपालिकाको फोहोर व्यवस्थापन योजना सार्वजनिक',
    summary: 'नगरपालिकाले फोहोर व्यवस्थापन योजना सार्वजनिक गरेको छ। स्रोतमै वर्गीकरण अनिवार्य गर्ने प्रस्ताव योजनामा समावेश छ। कार्यान्वयन आगामी आर्थिक वर्षबाट सुरु हुने र सचेतना कार्यक्रम पनि सञ्चालन गरिने जनाइएको छ।',
    pullQuote: 'स्रोतमै वर्गीकरण अनिवार्य हुने', author: 'ब. अधिकारी', minutesAgo: 900,
  },
  {
    slug: 'open-source-mapping-effort', language: 'en', category: 'tech', source: 'sample-tech',
    headline: 'Volunteer mapping effort covers additional wards',
    summary: 'A volunteer mapping effort has completed coverage of several additional wards, adding footpaths and drainage detail to the public dataset. Local authorities said the data would inform maintenance planning. The group plans to hold training sessions for new contributors next month.',
    pullQuote: 'Data to inform maintenance planning', author: null, minutesAgo: 1100, noImage: true,
  },
  {
    slug: 'currency-reserves-report', language: 'en', category: 'business', source: 'sample-post',
    headline: 'Reserves report shows steady import cover',
    summary: 'The latest reserves report shows import cover holding steady over the review period. Remittance inflows were cited as the main stabilising factor. The report cautioned that seasonal import demand in the coming quarter could narrow the margin somewhat.',
    pullQuote: 'Remittances cited as stabilising factor', author: 'M. Rai', minutesAgo: 1800,
  },
  {
    slug: 'heritage-restoration-phase-two', language: 'ne', category: 'nepal', source: 'namuna-khabar',
    headline: 'सम्पदा पुनर्निर्माणको दोस्रो चरण सुरु',
    summary: 'सम्पदा पुनर्निर्माणको दोस्रो चरणको काम सुरु भएको छ। परम्परागत सामग्री र सीप प्रयोग गरिने गुठीले जनाएको छ। काम सम्पन्न भएपछि क्षेत्रलाई आगन्तुकका लागि पुनः खुला गरिनेछ।',
    pullQuote: 'परम्परागत सामग्री र सीप प्रयोग हुने', author: 'र. श्रेष्ठ', minutesAgo: 3300,
  },
];

/** Consumed by the image generator so both stay in step. */
export const SEED_SLUGS = STORIES.map((s) => ({ slug: s.slug, category: s.category }));

export const SOURCES = [
  { slug: 'namuna-khabar', displayName: 'नमुना खबर', language: 'ne' as const, priority: 20 },
  { slug: 'namuna-samachar', displayName: 'नमुना समाचार', language: 'ne' as const, priority: 30 },
  { slug: 'namuna-khel', displayName: 'नमुना खेल', language: 'ne' as const, priority: 40 },
  { slug: 'sample-post', displayName: 'Sample Post', language: 'en' as const, priority: 20 },
  { slug: 'sample-tech', displayName: 'Sample Tech Weekly', language: 'en' as const, priority: 50 },
];
