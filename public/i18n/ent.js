/* « Langue des Ents » : un français très, très lent. Langue de fantaisie originale.
 * Les clés absentes reprennent le français, ralenti automatiquement (I18N.entify). Ici, les phrases
 * sur mesure des messages clés. En mode Ent, les personnages bougent aussi plus lentement (×0,7). */
(function (root) {
  'use strict';
  const D = {
    'lang.menu': 'Langue… des… Ents…',
    'app.title': 'Carte… de… la… Terre… du… Milieu',
    'app.titleWaiting': '({count}) 🔥 Carte… de… la… Terre… du… Milieu',
    'btn.demoOn': 'Démo… : ON',
    'btn.demoOff': 'Démo… : OFF',
    'header.reserves': 'Réserves… du… royaume',

    'log.edit': [
      'Hrrm… {actor}… a… martelé… {file}… il… y… a… peu… d’hivers…',
      'Hoom… {actor}… forge… {file}… lentement… comme… pousse… le… chêne…',
      'Hrrm… {actor}… affûte… {file}… hoom… sans… se… presser…',
      'Hm, hoom… {actor}… retrempe… {file}… une… fois… encore… hrrm…',
    ],
    'log.write': 'Hoom… {actor}… coule… {file}… dans… l’acier… neuf… il… ne… faut… pas… se… hâter…',
    'log.read': 'Hrrm… {actor}… lit… {file}… page… après… page… hoom…',
    'log.readMany': { one: 'Hrrm… {actor}… a… lu… {count}… parchemin… et… il… y… songe… encore…', other: 'Hrrm… {actor}… a… lu… {count}… parchemins… et… il… y… songe… encore… hoom…' },
    'log.grep': 'Hoom… {actor}… cherche… « {pat} »… racine… après… racine…',
    'log.grepIn': 'Hoom… {actor}… cherche… « {pat} »… dans… {dir}… racine… après… racine…',
    'log.websearch': 'Hrrm… {actor}… a… demandé… aux… étoiles… « {q} »… elles… répondront… un… jour… hoom…',
    'log.bashTest': 'Hoom… {actor}… met… les… tests… à… l’épreuve… {cmd}… il… faut… du… temps… hrrm…',
    'log.bash': 'Hrrm… {actor}… frappe… un… rocher… {cmd}… le… rocher… attend… lui… aussi…',
    'log.start': 'Hrrm… hoom… une… nouvelle… compagnie… s’éveille… {where}… {project}… il… ne… faut… pas… la… brusquer…',
    'log.startNowhere': 'Hrrm… hoom… une… nouvelle… compagnie… s’éveille… {project}…',
    'log.prompt': 'Hoom… une… quête… nouvelle… pour… {project}… « {prompt} »… prenons… le… temps… d’y… réfléchir…',
    'log.rest': 'Hrrm… {project}… pose… son… sac… et… se… repose… comme… une… vieille… souche… hoom…',
    'log.resume': 'Hoom… la… balise… de… {project}… s’éteint… la… compagnie… repart… doucement…',
    'log.spawn': 'Hrrm… {project}… envoie… {role}… ({type})… en… mission… {desc}… sans… hâte… hoom…',
    'log.message': 'Hoom… un… aigle… porte… un… message… de… {from}… à… {to}… les… aigles… sont… si… pressés… hrrm…',
    'log.return': 'Hrrm… {role}… de… {project}… ({type})… revient… de… mission… déjà ? hoom…',
    'log.alert': 'Hrrm ! hoom… les… feux… d’alarme… sont… allumés… {who}… attend… ta… réponse… {msg}… ne… le… fais… pas… trop… attendre… hoom…',
    'log.ask': 'Hrrm ! les… feux… d’alarme… sont… allumés… {who}… te… demande… « {q} »… réfléchis… bien… hoom…',
    'log.asleep': 'Hoom… {project}… s’est… endormi… sous… les… étoiles… comme… un… arbre… en… hiver… hrrm…',
    'log.end': 'Hrrm… la… compagnie… de… {project}… quitte… la… Terre… du… Milieu… si… vite…',
    'log.bag': 'Hoom… le… sac… de… {who}… est… plein… {pct} %… du… contexte… hrrm…',
    'log.five100': 'Hrrm… plus… de… pain… de… route… {pct} %… de… la… limite… 5 h… la… compagnie… campe… et… attend… les… arbres… savent… attendre… hoom…',
    'log.five80': 'Hoom… le… pain… de… route… s’épuise… {pct} %… de… la… limite… 5 h… hrrm…',

    'log.five50': 'Hrrm… la… moitié… du… pain… de… route… est… mangée… {pct} %… de… la… limite… 5 h… hoom…',
    'log.mcp': 'Hoom… {actor}… regarde… dans… la… pierre… voyante… {server}… longtemps…',
    'log.mcpTool': 'Hoom… {actor}… regarde… dans… la… pierre… voyante… {server}… ({name})… longtemps…',
    'act.mcp': 'Pierre… voyante… {server}…',
    'gauge.five': 'Pain… de… route',
    'tab.council': 'Conseil… des… arbres',

    'bubble.waiting': 'Hrrm… j’attends… ta… réponse…',
    'bubble.starved': 'Hoom… plus… de… pain… de… route…',
    'bubble.bagFull': 'Hrrm… mon… sac… est… plein…',

    'empty.title': 'Hrrm… aucune… compagnie… en… route…',
    'feed.emptyChronicle': 'Hoom… la… chronique… est… encore… vierge… lance… le… mode… démo… ou… une… session… Claude Code… rien… ne… presse…',
    'feed.emptyCouncil': 'Hrrm… aucun… conseil… ne… s’est… encore… réuni… les… conseils… prennent… du… temps…',
    'alert.fires': 'Hrrm ! les… feux… d’alarme… sont… allumés…',
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
  else root.LOTRI18N.register('ent', D);
})(typeof window !== 'undefined' ? window : globalThis);
