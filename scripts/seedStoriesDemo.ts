/**
 * The demonstration corpus.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 *
 * A large, realistic-looking body of stories so the app can be shown to someone
 * with a full feed in every section rather than four cards and a gap. It exists
 * to demonstrate the PRODUCT, not to stand in for journalism.
 *
 * So every story below is written to the same rule as the smaller fixture set:
 *
 *   • Publishers are invented. "नमुना खबर", "Sample Post" — never a real outlet.
 *   • No real, named private individual appears, and no quote is attributed to
 *     one. Where a story needs a voice it is an unnamed official or organiser,
 *     which is also how a great deal of real wire copy reads.
 *   • Nothing states a checkable fact about a real institution — no index
 *     levels, no budget figures, no match results. The texture is realistic;
 *     the specifics are deliberately not.
 *
 * That last rule is the one that is tempting to break, because invented numbers
 * make a demo look sharper. They also make it a fabricated record, and a news
 * product that is relaxed about that on day one has nothing left to sell.
 *
 * `imageQuery` drives the Wikimedia Commons search in fetch-demo-images.ts.
 * Keep it concrete and photographable — "Kathmandu street market" finds
 * something; "economic policy" does not.
 */

import type { SeedStory } from './seedStories.js';

/** Minutes ago, spread so the feed has a believable recency gradient. */
let t = 12;
const ago = (step = 17) => (t += step);

export const DEMO_STORIES: SeedStory[] = [
  /* ── नेपाल / Nepal ──────────────────────────────────────────────────── */
  {
    slug: 'demo-ne-highway-widening-phase', language: 'ne', category: 'nepal', source: 'namuna-khabar',
    headline: 'राजमार्ग विस्तारको दोस्रो चरण सुरु',
    summary: 'राजमार्ग विस्तार आयोजनाको दोस्रो चरणको काम सुरु भएको छ। यस चरणमा पहिरो जोखिम रहेका खण्डमा सुरक्षा पर्खाल निर्माण गरिनेछ। काम चलिरहेका बेला दिउँसोको समयमा एकतर्फी सवारी सञ्चालन हुने आयोजनाले जनाएको छ।',
    pullQuote: 'दिउँसो एकतर्फी सवारी सञ्चालन', author: 'स. गुरुङ', minutesAgo: ago(9),
    imageQuery: 'Nepal highway mountain road',
  },
  {
    slug: 'demo-ne-drinking-water-project', language: 'ne', category: 'nepal', source: 'namuna-samachar',
    headline: 'खानेपानी आयोजनाको परीक्षण सफल',
    summary: 'नगरपालिकाको खानेपानी आयोजनाको परीक्षण चरण सफल भएको छ। परीक्षणका क्रममा वितरण प्रणालीमा देखिएका सानातिना समस्या सच्याइएको आयोजना कार्यालयले जनाएको छ। नियमित वितरण आगामी महिनाबाट सुरु हुने कार्यक्रम रहेको छ।',
    pullQuote: null, author: null, minutesAgo: ago(),
    imageQuery: 'Nepal village water tap',
  },
  {
    slug: 'demo-en-monsoon-preparedness-drill', language: 'en', category: 'nepal', source: 'sample-post',
    headline: 'Districts run monsoon preparedness drill',
    summary: 'Local bodies in several districts ran a joint monsoon preparedness exercise this week, rehearsing evacuation routes and the distribution of emergency supplies. Organisers said the drill was intended to test coordination between ward offices and volunteers rather than to respond to any current warning.',
    pullQuote: 'A test of coordination, not a warning', author: 'A. Thapa', minutesAgo: ago(),
    imageQuery: 'Nepal flood rescue volunteers',
  },
  {
    slug: 'demo-ne-heritage-restoration', language: 'ne', category: 'nepal', source: 'namuna-khabar',
    headline: 'सम्पदा पुनर्निर्माणको काम अन्तिम चरणमा',
    summary: 'पुरातात्विक महत्वको संरचनाको पुनर्निर्माण अन्तिम चरणमा पुगेको छ। परम्परागत सीप प्रयोग गरी काठ र इँटाको काम गरिएको छ। काम सम्पन्न भएपछि क्षेत्र आगन्तुकका लागि पुनः खुला गरिने जनाइएको छ।',
    pullQuote: 'परम्परागत सीप प्रयोग', author: 'र. श्रेष्ठ', minutesAgo: ago(),
    imageQuery: 'Bhaktapur Durbar Square temple',
  },
  {
    slug: 'demo-en-community-forest-handover', language: 'en', category: 'nepal', source: 'sample-post',
    headline: 'Community forest handed to local users group',
    summary: 'A stretch of community forest has been formally handed to a local users group under a renewed management agreement. The group will be responsible for thinning, fire lines and grazing rotation. Officials said similar handovers are planned in neighbouring wards once boundary mapping is complete.',
    pullQuote: null, author: null, minutesAgo: ago(),
    imageQuery: 'Nepal forest hills landscape',
  },
  {
    slug: 'demo-ne-school-meal-programme', language: 'ne', category: 'nepal', source: 'namuna-samachar',
    headline: 'विद्यालयमा दिवा खाजा कार्यक्रम विस्तार',
    summary: 'दिवा खाजा कार्यक्रम थप विद्यालयमा विस्तार गरिएको छ। स्थानीय उत्पादनलाई प्राथमिकता दिने गरी खरिद प्रक्रिया तय गरिएको जनाइएको छ। कार्यक्रमको प्रभावकारिता अनुगमन गर्न अभिभावक समिति गठन गरिने भएको छ।',
    pullQuote: 'स्थानीय उत्पादनलाई प्राथमिकता', author: null, minutesAgo: ago(),
    imageQuery: 'Nepal school children classroom',
  },
  {
    slug: 'demo-en-bridge-opens-to-traffic', language: 'en', category: 'nepal', source: 'sample-post',
    headline: 'Suspension bridge reopens after repairs',
    summary: 'A pedestrian suspension bridge has reopened after several months of repair work on its cables and decking. Residents had been using a longer river crossing while the work was under way. Engineers said load testing was completed before the bridge was returned to public use.',
    pullQuote: 'Load testing completed before reopening', author: 'A. Thapa', minutesAgo: ago(),
    imageQuery: 'Nepal suspension bridge river',
  },
  {
    slug: 'demo-ne-waste-segregation-rule', language: 'ne', category: 'nepal', source: 'namuna-khabar',
    headline: 'फोहोर छुट्याउने नियम कार्यान्वयनमा',
    summary: 'घरबाटै फोहोर छुट्याउनुपर्ने व्यवस्था कार्यान्वयनमा आएको छ। सुरुका महिनामा सचेतना र सम्झाउने कार्यक्रम मात्र सञ्चालन गरिने नगरपालिकाले जनाएको छ। संकलन तालिका वडा कार्यालयमार्फत सार्वजनिक गरिएको छ।',
    pullQuote: null, author: 'स. गुरुङ', minutesAgo: ago(), noImage: true,
  },

  /* ── राजनीति / Politics ─────────────────────────────────────────────── */
  {
    slug: 'demo-ne-committee-report-tabled', language: 'ne', category: 'politics', source: 'namuna-samachar',
    headline: 'समितिको प्रतिवेदन पेस',
    summary: 'संसदीय समितिले अध्ययन प्रतिवेदन पेस गरेको छ। प्रतिवेदनमा सिफारिस कार्यान्वयनको समयसीमा तोकिएको छ। सम्बन्धित मन्त्रालयले प्रतिक्रिया दिन एक महिनाको समय पाउने समितिका पदाधिकारीले बताएका छन्।',
    pullQuote: 'कार्यान्वयनको समयसीमा तोकियो', author: 'र. श्रेष्ठ', minutesAgo: ago(),
    imageQuery: 'Nepal parliament building Kathmandu',
  },
  {
    slug: 'demo-en-local-budget-consultation', language: 'en', category: 'politics', source: 'sample-post',
    headline: 'Wards open budget consultation meetings',
    summary: 'Ward offices have begun public consultation meetings ahead of the local budget cycle. Residents can submit proposals in person or through ward secretaries. Officials said proposals affecting more than one ward will be forwarded to the municipal assembly rather than decided locally.',
    pullQuote: null, author: null, minutesAgo: ago(),
    imageQuery: 'Nepal community meeting village',
  },
  {
    slug: 'demo-ne-election-roll-update', language: 'ne', category: 'politics', source: 'namuna-khabar',
    headline: 'मतदाता नामावली अद्यावधिक कार्यक्रम',
    summary: 'मतदाता नामावली अद्यावधिक गर्ने कार्यक्रम सुरु भएको छ। नयाँ नाम दर्ता र ठेगाना सच्याउने काम वडा कार्यालयबाटै हुनेछ। कार्यक्रमको समयतालिका र आवश्यक कागजातको सूची सार्वजनिक गरिएको छ।',
    pullQuote: 'दर्ता वडा कार्यालयबाटै', author: null, minutesAgo: ago(),
    imageQuery: 'Nepal election voters queue',
  },
  {
    slug: 'demo-en-federal-grant-guidelines', language: 'en', category: 'politics', source: 'sample-post',
    headline: 'New guidelines issued for conditional grants',
    summary: 'Revised guidelines for conditional grants to local governments have been issued, setting out reporting formats and the timing of instalments. Local officials had asked for clearer rules after delays in earlier cycles. The guidelines take effect from the next fiscal year.',
    pullQuote: 'Clearer rules after earlier delays', author: 'A. Thapa', minutesAgo: ago(),
    imageQuery: 'Nepal government office building',
  },
  {
    slug: 'demo-ne-public-hearing-held', language: 'ne', category: 'politics', source: 'namuna-samachar',
    headline: 'सार्वजनिक सुनुवाइमा सेवाग्राहीको गुनासो',
    summary: 'स्थानीय तहले आयोजना गरेको सार्वजनिक सुनुवाइमा सेवाग्राहीले सिफारिस र दर्ता प्रक्रियामा लाग्ने समयबारे गुनासो राखे। कार्यालयले अनलाइन दर्ता प्रणाली विस्तार गर्ने प्रतिबद्धता जनाएको छ। अर्को सुनुवाइ तीन महिनापछि हुनेछ।',
    pullQuote: null, author: 'स. गुरुङ', minutesAgo: ago(),
    imageQuery: 'Nepal public gathering hall',
  },
  {
    slug: 'demo-en-committee-seeks-submissions', language: 'en', category: 'politics', source: 'sample-post',
    headline: 'Committee invites written submissions',
    summary: 'A parliamentary committee has invited written submissions on a draft it is reviewing, giving stakeholders three weeks to respond. Submissions may be filed by post or through the committee secretariat. A summary of the responses will be published alongside the committee report.',
    pullQuote: 'Three weeks to respond', author: null, minutesAgo: ago(),
    imageQuery: 'Nepal parliament interior session',
  },

  /* ── अर्थतन्त्र / Business ──────────────────────────────────────────── */
  {
    slug: 'demo-ne-tea-export-season', language: 'ne', category: 'business', source: 'namuna-khabar',
    headline: 'चिया निर्यातको मौसम सुरु',
    summary: 'पूर्वी पहाडी क्षेत्रबाट चिया निर्यातको मौसम सुरु भएको छ। प्रशोधन केन्द्रहरूले दैनिक संकलन बढाएका छन्। गुणस्तर परीक्षण र प्याकेजिङका लागि थप जनशक्ति परिचालन गरिएको व्यवसायीहरूले बताएका छन्।',
    pullQuote: 'दैनिक संकलन बढ्यो', author: 'र. श्रेष्ठ', minutesAgo: ago(),
    imageQuery: 'Nepal tea garden Ilam plantation',
  },
  {
    slug: 'demo-en-cooperative-audit-deadline', language: 'en', category: 'business', source: 'sample-post',
    headline: 'Cooperatives reminded of audit deadline',
    summary: 'Savings and credit cooperatives have been reminded to complete their annual audits before the filing deadline. The regulator said a portion of registered cooperatives file late each year, which delays consolidated reporting. Extensions will be granted only on written request with reasons.',
    pullQuote: 'Extensions only on written request', author: 'A. Thapa', minutesAgo: ago(),
    imageQuery: 'Nepal shop counter money',
  },
  {
    slug: 'demo-ne-handicraft-fair-opens', language: 'ne', category: 'business', source: 'namuna-samachar',
    headline: 'हस्तकला मेला सुरु',
    summary: 'हस्तकला उत्पादनको प्रवर्धन गर्ने उद्देश्यले मेला सुरु भएको छ। मेलामा काठ, धातु र बुनाइका उत्पादन प्रदर्शनमा राखिएका छन्। उत्पादकहरूले प्रत्यक्ष बिक्रीसँगै अर्डर लिने व्यवस्था मिलाइएको आयोजकले जनाएका छन्।',
    pullQuote: null, author: null, minutesAgo: ago(),
    imageQuery: 'Nepal handicraft market stall',
  },
  {
    slug: 'demo-en-cold-storage-capacity', language: 'en', category: 'business', source: 'sample-post',
    headline: 'Cold storage capacity added for vegetable growers',
    summary: 'A cold storage facility serving vegetable growers has added capacity ahead of the harvest, allowing produce to be held longer before it reaches market. Growers had reported losses during past gluts. Booking will be handled through the local cooperative on a first-come basis.',
    pullQuote: 'Produce can be held longer', author: null, minutesAgo: ago(),
    imageQuery: 'Nepal vegetable market produce',
  },
  {
    slug: 'demo-ne-tourism-arrivals-season', language: 'ne', category: 'business', source: 'namuna-khabar',
    headline: 'पर्यटन मौसमको तयारी तीव्र',
    summary: 'शरद मौसमलाई लक्ष्य गरी पर्यटन व्यवसायीले तयारी तीव्र पारेका छन्। होटेल र लजमा मर्मत तथा तालिम कार्यक्रम सञ्चालन भइरहेका छन्। पदमार्गका सूचना पाटी र सुरक्षा चिन्ह अद्यावधिक गर्ने काम पनि भइरहेको छ।',
    pullQuote: 'पदमार्गका सूचना पाटी अद्यावधिक', author: 'स. गुरुङ', minutesAgo: ago(),
    imageQuery: 'Nepal trekking Annapurna trail',
  },
  {
    slug: 'demo-en-digital-payment-training', language: 'en', category: 'business', source: 'sample-post',
    headline: 'Traders given digital payment training',
    summary: 'Small traders in a market area have been given training on accepting digital payments, covering reconciliation and how to handle failed transactions. Organisers said the sessions were prompted by traders reporting confusion when a payment shows as pending on one side only.',
    pullQuote: null, author: 'A. Thapa', minutesAgo: ago(),
    imageQuery: 'Nepal shopkeeper mobile phone',
  },

  /* ── विश्व / World ──────────────────────────────────────────────────── */
  {
    slug: 'demo-en-regional-transport-talks', language: 'en', category: 'world', source: 'sample-post',
    headline: 'Regional transport talks resume',
    summary: 'Officials from neighbouring countries have resumed talks on cross-border transport arrangements, focusing on cargo clearance times and documentation. Delegates described the round as technical rather than political. A working group will report before the next scheduled meeting.',
    pullQuote: 'Technical rather than political', author: null, minutesAgo: ago(),
    imageQuery: 'border crossing trucks cargo',
  },
  {
    slug: 'demo-ne-himalayan-glacier-study', language: 'ne', category: 'world', source: 'namuna-samachar',
    headline: 'हिमनदी अध्ययनको प्रारम्भिक नतिजा',
    summary: 'हिमाली क्षेत्रमा गरिएको हिमनदी अध्ययनको प्रारम्भिक नतिजा सार्वजनिक भएको छ। अध्ययनमा उपग्रह तस्बिर र स्थलगत नापको तुलना गरिएको छ। विस्तृत प्रतिवेदन समीक्षापछि प्रकाशित हुने अनुसन्धान टोलीले जनाएको छ।',
    pullQuote: null, author: null, minutesAgo: ago(),
    imageQuery: 'Himalaya glacier mountain snow',
  },
  {
    slug: 'demo-en-climate-adaptation-fund', language: 'en', category: 'world', source: 'sample-post',
    headline: 'Adaptation fund opens application window',
    summary: 'A regional climate adaptation fund has opened its application window for community-level projects. Proposals must show local co-financing and a maintenance plan beyond the grant period. Reviewers said past rounds favoured projects with clear ownership after handover.',
    pullQuote: 'Ownership after handover matters', author: 'A. Thapa', minutesAgo: ago(),
    imageQuery: 'terraced fields agriculture Asia',
  },
  {
    slug: 'demo-ne-labour-migration-briefing', language: 'ne', category: 'world', source: 'namuna-khabar',
    headline: 'वैदेशिक रोजगारसम्बन्धी जानकारीमूलक कार्यक्रम',
    summary: 'वैदेशिक रोजगारमा जान लागेकाहरूका लागि जानकारीमूलक कार्यक्रम सञ्चालन गरिएको छ। कार्यक्रममा सम्झौतापत्र पढ्ने र सम्पर्क विवरण सुरक्षित राख्ने विषयमा जोड दिइएको छ। सहभागीलाई आधिकारिक सूचना स्रोतबारे पनि जानकारी दिइयो।',
    pullQuote: 'सम्झौतापत्र पढ्न जोड', author: 'र. श्रेष्ठ', minutesAgo: ago(),
    imageQuery: 'Kathmandu airport terminal',
  },
  {
    slug: 'demo-en-aviation-safety-audit', language: 'en', category: 'world', source: 'sample-post',
    headline: 'Aviation safety audit findings published',
    summary: 'Findings from a routine aviation safety audit have been published, with recommendations on maintenance record-keeping and crew scheduling. The auditing body said most items were administrative. Operators have been asked to submit a corrective action plan within the quarter.',
    pullQuote: null, author: null, minutesAgo: ago(),
    imageQuery: 'small aircraft mountain airport Nepal',
  },

  /* ── खेलकुद / Sports ────────────────────────────────────────────────── */
  {
    slug: 'demo-ne-national-athletics-meet', language: 'ne', category: 'sports', source: 'namuna-khel',
    headline: 'राष्ट्रिय एथलेटिक्स प्रतियोगिता सुरु',
    summary: 'राष्ट्रिय एथलेटिक्स प्रतियोगिता सुरु भएको छ। प्रतियोगितामा प्रदेशका टोली सहभागी छन्। छनोट भएका खेलाडीलाई आगामी अन्तर्राष्ट्रिय प्रतियोगिताको तयारी शिविरमा समावेश गरिने आयोजकले जनाएका छन्।',
    pullQuote: 'छनोट भएका खेलाडी तयारी शिविरमा', author: null, minutesAgo: ago(),
    imageQuery: 'athletics running track stadium',
  },
  {
    slug: 'demo-en-school-football-league', language: 'en', category: 'sports', source: 'sample-post',
    headline: 'School football league expands to more districts',
    summary: 'A school football league has expanded to additional districts this season, with organisers adding a girls division. Matches will be played at weekends to avoid clashing with exam schedules. Organisers said referee training was arranged before the season opened.',
    pullQuote: 'A girls division added this season', author: null, minutesAgo: ago(),
    imageQuery: 'school football match children playing',
  },
  {
    slug: 'demo-ne-climbing-permits-season', language: 'ne', category: 'sports', source: 'namuna-khel',
    headline: 'आरोहण मौसमको तयारी सुरु',
    summary: 'आरोहण मौसमलाई लक्ष्य गरी तयारी सुरु भएको छ। आधार शिविरसम्मको बाटो र पुल मर्मतको काम भइरहेको छ। सहयोगी कर्मचारीका लागि सुरक्षा तालिम सञ्चालन गरिएको सम्बन्धित संस्थाले जनाएको छ।',
    pullQuote: null, author: 'स. गुरुङ', minutesAgo: ago(),
    imageQuery: 'Everest base camp climbers',
  },
  {
    slug: 'demo-en-volleyball-championship', language: 'en', category: 'sports', source: 'sample-post',
    headline: 'Volleyball championship draws record entries',
    summary: 'A regional volleyball championship has drawn its largest number of entries, prompting organisers to add a second court and extend the tournament by a day. Team registration closed earlier than planned. The final will be played under floodlights for the first time.',
    pullQuote: 'The final under floodlights', author: 'A. Thapa', minutesAgo: ago(),
    imageQuery: 'volleyball match players court',
  },
  {
    slug: 'demo-ne-cycling-race-route', language: 'ne', category: 'sports', source: 'namuna-khel',
    headline: 'साइक्लिङ दौडको मार्ग सार्वजनिक',
    summary: 'साइक्लिङ दौडको मार्ग सार्वजनिक गरिएको छ। दौड सहरी खण्डबाट सुरु भई पहाडी उकालो हुँदै फर्कनेछ। दौडका दिन निश्चित समयका लागि सडक खण्ड बन्द हुने र वैकल्पिक मार्ग प्रयोग गर्न आग्रह गरिएको छ।',
    pullQuote: 'वैकल्पिक मार्ग प्रयोग गर्न आग्रह', author: null, minutesAgo: ago(),
    imageQuery: 'cycling race road cyclists',
  },

  /* ── प्रविधि / Technology ───────────────────────────────────────────── */
  {
    slug: 'demo-en-fibre-rollout-wards', language: 'en', category: 'tech', source: 'sample-tech',
    headline: 'Fibre rollout reaches outlying wards',
    summary: 'A fibre broadband rollout has reached outlying wards that previously relied on wireless links. Installers said the terrain made trenching slow in parts of the route. Households on the existing wireless service will be migrated in batches rather than all at once.',
    pullQuote: 'Migration will happen in batches', author: null, minutesAgo: ago(),
    imageQuery: 'fibre optic cable installation',
  },
  {
    slug: 'demo-ne-digital-literacy-classes', language: 'ne', category: 'tech', source: 'namuna-khabar',
    headline: 'डिजिटल साक्षरता कक्षा सञ्चालन',
    summary: 'सामुदायिक पुस्तकालयमा डिजिटल साक्षरता कक्षा सञ्चालन भइरहेको छ। कक्षामा अनलाइन सेवा प्रयोग र सुरक्षित पासवर्ड बनाउने विषय समेटिएको छ। सहभागीका लागि अभ्यास सामग्री नेपालीमै उपलब्ध गराइएको छ।',
    pullQuote: 'अभ्यास सामग्री नेपालीमै', author: 'र. श्रेष्ठ', minutesAgo: ago(),
    imageQuery: 'computer training class students',
  },
  {
    slug: 'demo-en-open-data-portal-refresh', language: 'en', category: 'tech', source: 'sample-tech',
    headline: 'Open data portal gets a refresh',
    summary: 'A public open data portal has been rebuilt with a faster search and downloadable formats that no longer require an account. Maintainers said the previous version was difficult to use on a phone. Datasets now carry a last-updated date on the listing page.',
    pullQuote: 'Datasets now show a last-updated date', author: null, minutesAgo: ago(),
    imageQuery: 'computer screen data dashboard',
  },
  {
    slug: 'demo-ne-solar-microgrid-village', language: 'ne', category: 'tech', source: 'namuna-samachar',
    headline: 'सौर्य माइक्रोग्रिड सञ्चालनमा',
    summary: 'बस्तीमा सौर्य माइक्रोग्रिड सञ्चालनमा आएको छ। प्रणालीले सिँचाइ पम्प र सामुदायिक भवनलाई बिजुली उपलब्ध गराउनेछ। मर्मतका लागि स्थानीय युवालाई तालिम दिइएको र पुर्जा स्थानीय रूपमै भण्डारण गरिएको जनाइएको छ।',
    pullQuote: 'मर्मतका लागि स्थानीय युवा तालिमप्राप्त', author: null, minutesAgo: ago(),
    imageQuery: 'solar panels village rural',
  },
  {
    slug: 'demo-en-weather-station-network', language: 'en', category: 'tech', source: 'sample-tech',
    headline: 'Automatic weather stations added to network',
    summary: 'Automatic weather stations have been added to a monitoring network in hill districts, feeding readings to a public dashboard. Technicians said gaps in coverage had made short-range forecasting difficult in some valleys. Data from the new stations will be published after a calibration period.',
    pullQuote: null, author: 'A. Thapa', minutesAgo: ago(), noImage: true,
  },
  {
    slug: 'demo-ne-ecommerce-delivery-pilot', language: 'ne', category: 'tech', source: 'namuna-khabar',
    headline: 'सहरी क्षेत्रमा डेलिभरी पाइलट',
    summary: 'सहरी क्षेत्रमा साना पसलका लागि साझा डेलिभरी पाइलट सुरु भएको छ। पाइलटमा एउटै यातायात प्रयोग गरी धेरै पसलको सामान पुर्‍याइनेछ। खर्च र समय दुवैमा बचत हुने अपेक्षा गरिएको आयोजकले बताएका छन्।',
    pullQuote: 'एउटै यातायात, धेरै पसल', author: 'स. गुरुङ', minutesAgo: ago(),
    imageQuery: 'delivery scooter city street Asia',
  },
];
