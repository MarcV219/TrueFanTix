import sanitizeHtmlLibrary from "sanitize-html";

const allowedTags = ["p", "div", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a"];

const emailBlockStyles: Record<string, string> = {
  p: "margin:0 0 16px",
  ul: "margin:0 0 16px;padding-left:28px",
  ol: "margin:0 0 16px;padding-left:28px",
  li: "margin:0 0 6px",
};

export const outreachLegalFooterText = `TrueFanTix
1547 Gill Road
Midhurst, Ontario L9X 1M5
Canada

This is a commercial message from TrueFanTix.`;

export function sanitizeOutreachHtml(value: string) {
  return sanitizeHtmlLibrary(value, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title", "target", "style"],
      p: ["id", "style"],
      div: ["id"],
      ul: ["style"],
      ol: ["style"],
      li: ["style"],
    },
    allowedStyles: {
      a: {
        "background-color": [/^#[0-9a-f]{3,6}$/i],
        color: [/^#[0-9a-f]{3,6}$/i],
        display: [/^inline-block$/],
        padding: [/^\d{1,2}px \d{1,2}px$/],
        "border-radius": [/^\d{1,2}px$/],
        "text-decoration": [/^none$/],
        "font-weight": [/^(bold|[5-9]00)$/],
        margin: [/^\d{1,2}px$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: attribs.href?.startsWith("#")
          ? { ...attribs }
          : { ...attribs, target: "_blank" },
      }),
      ...Object.fromEntries(Object.entries(emailBlockStyles).map(([tagName, style]) => [tagName, (_name: string, attribs: Record<string, string>) => ({ tagName, attribs: { ...attribs, style } })])),
    },
    exclusiveFilter(frame) {
      return frame.tag === "a" && !frame.attribs.href;
    },
  }).trim();
}

export const quebecCollaborationSubject =
  "Une option de revente de billets axée sur les fans pour {{organization}} / A fan-first ticket resale option for the {{organization}}";

export const quebecCollaborationHtml = `<p><strong>Choisissez votre langue / Choose your language</strong></p><p><a href="#francais" style="background-color:#1d4ed8;color:#ffffff;display:inline-block;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold;margin:4px">Français</a> <a href="#english" style="background-color:#1d4ed8;color:#ffffff;display:inline-block;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold;margin:4px">English</a></p><p id="francais"><strong>Français</strong></p><p>Bonjour {{firstName}},</p><p>Je m’appelle Marc Villeneuve et je suis le fondateur de TrueFanTix, une nouvelle plateforme de revente de billets entre fans fondée sur un principe simple : les fans devraient pouvoir céder les billets qu’ils ne peuvent pas utiliser et se procurer des billets sans que ceux-ci fassent l’objet de majorations à des fins lucratives ou de frais de revente excessifs.</p><p>Je communique avec vous parce que je crois que TrueFanTix pourrait compléter les programmes de billetterie actuels de {{organization}} en offrant une autre option axée sur les fans aux détenteurs d’abonnements de saison et aux autres partisans. Cette option aiderait les membres à récupérer le montant payé pour les billets qu’ils ne peuvent pas utiliser, tout en donnant à d’autres véritables fans la possibilité d’assister à un événement à un prix équitable.</p><p>TrueFanTix se distingue fondamentalement des plateformes de revente traditionnelles :</p><ul><li><strong>Valeur nominale ou moins :</strong> Les billets peuvent être mis en vente uniquement à un prix égal ou inférieur à leur valeur nominale vérifiée, auquel peuvent s’ajouter les frais initiaux admissibles qui ont été payés. Les vendeurs peuvent toujours choisir de les offrir à un prix inférieur.</li><li><strong>Aucuns frais pour les vendeurs :</strong> Les vendeurs reçoivent 100 % du prix de vente autorisé. Les membres peuvent ainsi récupérer le montant qu’ils ont payé sans devoir augmenter leur prix simplement pour compenser une commission exigée par la plateforme.</li><li><strong>Des frais peu élevés et transparents pour les acheteurs :</strong> Les acheteurs paient des frais d’administration de 8,75 %, clairement indiqués. Les frais totaux de notre plateforme sont fixes, publiés et prévisibles, et ne représentent que 8,75 % du prix du billet, ce qui est considérablement inférieur aux frais totaux généralement perçus auprès des acheteurs et des vendeurs par les principales plateformes de revente.</li><li><strong>Aucune majoration motivée par le profit :</strong> Le modèle de TrueFanTix est conçu pour permettre de véritables échanges entre fans, et non la revente spéculative.</li><li><strong>Transactions protégées :</strong> Les paiements et les transferts de billets sont effectués selon un processus documenté et protégé.</li><li><strong>Des fans qui aident d’autres fans :</strong> Les fans qui ne peuvent pas assister à un événement peuvent remettre leurs billets entre les mains d’autres fans à un prix équitable plutôt que de laisser des sièges inoccupés.</li><li><strong>Récompenses pour les événements à guichets fermés :</strong> Les vendeurs de billets admissibles pour des événements à guichets fermés peuvent obtenir un jeton d’accès sans date d’expiration, qu’ils pourront utiliser afin d’acheter un autre billet pour un événement à guichets fermés sur TrueFanTix. Aucun jeton d’accès n’est requis pour les événements qui ne sont pas à guichets fermés.</li></ul><p>Pour {{organization}}, nous croyons que ce modèle pourrait :</p><ul><li>Réduire le nombre de sièges inoccupés et attirer davantage de véritables fans dans le lieu de l’événement;</li><li>Accroître les dépenses effectuées les jours de match pour les concessions, les articles promotionnels et les autres achats;</li><li>Créer des occasions de faire découvrir l’expérience d’un match à de nouveaux fans;</li><li>Accroître la valeur offerte aux détenteurs d’abonnements de saison et de forfaits de plusieurs matchs en leur donnant un autre moyen de récupérer jusqu’au montant payé pour les billets qu’ils ne peuvent pas utiliser, sans frais de vente et sans avoir à majorer leurs billets simplement pour compenser une commission exigée par la plateforme;</li><li>Améliorer la satisfaction des membres et favoriser leur fidélisation à long terme;</li><li>Contribuer à préserver l’abordabilité des matchs;</li><li>Renforcer l’engagement de {{organization}} envers une expérience de billetterie équitable, transparente et axée sur les fans.</li></ul><p>Nous ne cherchons pas à remplacer les relations actuelles de {{organization}} avec ses partenaires de billetterie ni à proposer un partenariat universel et prédéfini. Nous aimerions plutôt déterminer si TrueFanTix pourrait jouer un rôle complémentaire qui apporterait de la valeur à votre organisation et, surtout, à vos fans.</p><p>Il pourrait s’agir simplement de présenter TrueFanTix à un groupe de détenteurs d’abonnements de saison, de l’inclure comme ressource supplémentaire offerte aux membres ou de mettre le concept à l’essai lors de certains matchs. Un projet pilote à petite échelle permettrait de mesurer la participation des fans, le nombre de billets échangés avec succès et la réduction potentielle du nombre de sièges inoccupés avant d’envisager une initiative plus vaste.</p><p>Nous serions également heureux d’établir une relation réciproque. TrueFanTix pourrait soutenir {{organization}} en faisant la promotion de ses offres officielles de billets, de ses campagnes d’abonnement, de ses promotions d’articles dérivés, de ses initiatives communautaires, de certains événements ou de tout autre contenu approuvé sur notre site Web ainsi que dans nos courriels et nos réseaux sociaux.</p><p>Avant de suggérer une approche particulière, j’aimerais toutefois commencer par mieux comprendre vos priorités ainsi que les défis que vous constatez actuellement concernant les billets inutilisés, la revente par les membres ou l’expérience offerte sur le marché secondaire. Nous pourrions ensuite déterminer si TrueFanTix est en mesure d’apporter une réelle valeur ajoutée.</p><p>Seriez-vous disponible pour une conversation exploratoire de 15 minutes afin de déterminer s’il pourrait y avoir une possibilité de collaboration?</p><p>Je vous remercie de votre temps.</p><p>Marc Villeneuve<br>Fondateur, TrueFanTix<br>Marc@TrueFanTix.com<br>TrueFanTix.com | TrueFanTix.ca</p><p id="english"><strong>English</strong></p><p>Hi {{firstName}},</p><p>I’m reaching out about a potential collaboration between {{organization}} and TrueFanTix.</p><p>TrueFanTix is a Canadian marketplace where fans can buy and resell tickets at or below their original price. We’d like to discuss how we could support your fans and ticketing goals.</p><p>Would you be open to a brief conversation?</p><p>Thanks,<br>Marc<br>TrueFanTix</p>`;

const attachmentEnglishSection = `<p id="english"><strong>English</strong></p><p>Hi {{firstName}},</p><p>I’m Marc Villeneuve, founder of TrueFanTix, a new fan-to-fan ticket marketplace built around a simple principle: fans should be able to pass along tickets they can’t use and access tickets without those tickets being marked up for profit or diminished by excessive resale fees.</p><p>I’m reaching out because I believe TrueFanTix could complement {{organization}}’s existing ticketing programs by providing another fan-first option for season-ticket members and other fans, helping members recover what they paid for tickets they can’t use while giving other genuine fans an opportunity to attend at a fair price.</p><p>TrueFanTix is fundamentally different from conventional resale marketplaces:</p><ul><li><strong>Face value or less:</strong> Tickets can be listed only up to their verified face value and eligible original fees paid. Sellers can always list for less.</li><li><strong>No seller fees:</strong> Sellers receive 100% of the permitted listing price, allowing members to recover what they paid without increasing their asking price simply to offset a marketplace commission.</li><li><strong>A low, transparent buyer fee:</strong> Buyers pay a clearly disclosed 8.75% administration fee. Our total marketplace fee is fixed, published and predictable at just 8.75% of the ticket price, substantially below the total fees typically collected from buyers and sellers by major resale platforms.</li><li><strong>No profit-driven markups:</strong> The TrueFanTix model is designed for genuine fan-to-fan exchange rather than speculative resale.</li><li><strong>Protected transactions:</strong> Payments and ticket transfers follow a documented, protected process.</li><li><strong>Fans helping fans:</strong> Fans who can’t attend can help put their tickets into the hands of other fans at fair prices rather than leaving seats unused.</li><li><strong>Rewards for sold-out events:</strong> Sellers of eligible tickets to sold-out events can earn a non-expiring Access Token toward another sold-out ticket on TrueFanTix. Access Tokens are not required for non-sold-out events.</li></ul><p>For {{organization}}, we believe this model has the potential to:</p><ul><li>Reduce unused seats and put more genuine fans in the venue</li><li>Increase game-day spending on concessions, merchandise and other purchases</li><li>Create opportunities to introduce new fans to the game-day experience</li><li>Enhance the value for season-ticket and multi-game members by giving members another way to recover up to what they paid for tickets they can’t use without seller fees or the need to mark up their tickets simply to offset a marketplace commission</li><li>Improve member satisfaction and support long-term retention</li><li>Help protect the affordability of attending games</li><li>Reinforce {{organization}}’s commitment to a fair, transparent and fan-first ticketing experience</li></ul><p>We’re not looking to replace {{organization}}’s existing ticketing relationships or propose a one-size-fits-all partnership. We’d like to explore whether there is a complementary role TrueFanTix could play that provides value to your organization and, most importantly, your fans.</p><p>That could be as simple as introducing TrueFanTix to a group of season-ticket members, including it as an additional member resource, or testing the concept around selected games. A small pilot could provide an opportunity to measure fan participation, tickets successfully exchanged and the potential reduction in unused seats before considering anything broader.</p><p>We’d also be happy to make the relationship reciprocal. TrueFanTix could support {{organization}} by promoting official ticket offers, membership campaigns, merchandise promotions, community initiatives, selected events or other approved content through our website, email and social channels.</p><p>Before suggesting any particular approach, however, I’d first like to understand your priorities and any challenges you currently see around unused tickets, member resale or the secondary-market experience. From there, we could determine whether TrueFanTix can add meaningful value.</p><p>Would you be open to a 15-minute introductory conversation to explore whether there might be a fit?</p><p>Thank you for your time,</p><p>Marc Villeneuve<br>Founder, TrueFanTix<br>Marc@TrueFanTix.com<br>TrueFanTix.com | TrueFanTix.ca</p>`;

export const completeQuebecCollaborationHtml = quebecCollaborationHtml.replace(
  /<p id="english">[\s\S]*$/,
  attachmentEnglishSection
    .replace("complement {{organization}}’s", "complement the {{organization}}’s")
    .replace("Reinforce {{organization}}’s commitment", "Reinforce the Organization’s commitment"),
);

export function outreachHtmlToText(value: string) {
  const blockAware = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|ul|ol)>/gi, "\n");
  return sanitizeHtmlLibrary(blockAware, { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function outreachHtmlDocument(bodyHtml: string, unsubscribeUrl: string) {
  const footerHtml = outreachLegalFooterText.replaceAll("\n", "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111827">${bodyHtml}<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">${footerHtml}<br><a href="${unsubscribeUrl}">Unsubscribe from TrueFanTix outreach emails</a></div></div>`;
}
