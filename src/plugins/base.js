import lang from 'bot-lang';
import nlp from 'compromise';
import Lemmer from 'lemmer';
import async from 'async';
import _ from 'lodash';
import pos from 'pos';
import http from 'http';
import nodejieba from 'nodejieba';

const tagger = new pos.Tagger();
const lexer = new pos.Lexer();

const debug = require('debug-levels')('SS:message');

const addTags = function addTags(cb) {
  this.message.tags = lang.tag.all(this.message.original);
  cb();
};

const addChineseNlpFromSyntaxNet = function addNlp(cb) {
  var date_clean_string = this.message.original;

  //Kenneth 20171129 轉換TOPIC時也會呼叫，但不用再做NLP了，預設要求Fully Match
  if (date_clean_string.match(/^__/)) {
    this.message.cnlp = [
      { output : [
          {"pos_tag" : "NN",
           "word" : date_clean_string
          }
        ]
      }
    ]
    cb();
    return;
  }

  date_clean_string = date_clean_string.replace(/昨日|昨天|前天|大前天|上星期|下星期|上?周|下?周|上上個月|上個月|上?星期/g,"日期");
  date_clean_string = date_clean_string.replace(/可否|是不是/g,"是否");

  //cleaning
  date_clean_string = date_clean_string.replace(/做的/g,"做");

  const postData = JSON.stringify({
    'strings' : [date_clean_string],
    'tree': false
  });

  const options = {
    hostname: '127.0.0.1',
    port: 9000,
    path: '/api/v1/query',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      //console.log(`BODY: ${chunk}`);
      this.message.cnlp = JSON.parse(chunk);
      //console.log("KennethTrace CNLP DATA: " + JSON.stringify(this.message.cnlp));
      cb();
    });
    res.on('end', () => {
      console.log('No more data in response.');
    });
  });

  req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
    cb(e);
  });

  // write data to request body
  req.write(postData);
  req.end();
};



const addChineseNlpFromJieba = function addNlp(cb) {
  var date_clean_string = this.message.original;

  //Kenneth 20171129 轉換TOPIC時也會呼叫，但不用再做NLP了，預設要求Fully Match
  if (date_clean_string.match(/^__/)) {
    this.message.cnlp = [
      { output : [
          {"pos_tag" : "NN",
           "word" : date_clean_string
          }
        ]
      }
    ]
    cb();
  } else {
    this.message.cnlp = nodejieba.query(date_clean_string);
    debug.log("CNLP2: " + JSON.stringify(this.message.cnlp));
    cb();
  }
};

const addNlp = function addNlp(cb) {
  var date_clean_string = this.message.original.replace(/(\d+)\so'?clock/,'$1:00');
  this.message.nlp = nlp(date_clean_string);
  cb();
};

const addEntities = function addEntities(cb) {
  // const entities = this.message.nlp.match('(#Person|#Place|#Organization)').out('array');
  // this.message.entities = entities;
  //
  // // For legacy support
  // this.message.names = this.message.nlp.people().out('array');
  // cb();
  var ary = [];
  this.message.cnlp[0].output.forEach(function(entry) {
    if (entry.hasOwnProperty('person')) ary.push(entry.word)
  })
  this.message.entities = ary;
  cb();
};

const addDates = function addDates(cb) {
  //this.message.dates = this.message.nlp.dates().out('array');
  var ary = [];
  this.message.cnlp[0].output.forEach(function(entry) {
    if (entry.hasOwnProperty('label') && entry.label == 'nmod:tmod')
      ary.push(entry.word);
    else if (entry.word == '日期')
      ary.push(entry.word);
  })
  this.message.dates = ary;
  cb();
};

const addWords = function addWords(cb) {
  //this.message.words = this.message.clean.split(' ');
  var ary = [];
  this.message.cnlp[0].output.forEach(function(entry) {
    ary.push(entry.word);
  });
  this.message.words = ary;
  cb();
};

const addPos = function addPos(cb) {
  // this.message.nouns = this.message.nlp.match('#Noun').out('array');
  // this.message.adverbs = this.message.nlp.match('#Adverb').out('array');
  // this.message.verbs = this.message.nlp.match('#Verb').out('array');
  // this.message.adjectives = this.message.nlp.match('#Adjective').out('array');
  // this.message.pronouns = this.message.nlp.match('#Pronoun').out('array');
  this.message.nouns = [];
  this.message.adverbs = [];
  this.message.verbs = [];
  this.message.adjectives = [];
  this.message.pronouns = [];
  var msg = this.message;
  this.message.cnlp[0].output.forEach(function(entry) {
    if (entry.pos_tag === 'NN')
      msg.nouns.push(entry.word);
    else if (entry.pos_tag === 'RB')
      msg.adverbs.push(entry.word);
    else if (entry.pos_tag === 'VV')
      msg.verbs.push(entry.word);
    else if (entry.pos_tag === 'PRP')
      msg.pronouns.push(entry.word);
    else if (entry.pos_tag === 'JJ')
      msg.adjectives.push(entry.word);
    else {
      msg.nouns.push(entry.word);
      console.log("not assigne group: " + JSON.stringify(entry));
    }
  })

  // Fix for pronouns getting mixed in with nouns
  _.pullAll(this.message.nouns, this.message.pronouns);
  cb();
};

const addEmail = function addEmail(cb) {
  let raw = this.message.raw;
  this.message.emails = raw.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
  cb();
};


// We look at math type questions
// What is 1+1?
// What is 4+2-1?
// What is 50 percent of 40?
// What is half of six?
// What is seven multiplied by six?
// What is 7 divided by 0?
// What is the square root of 9?
// What is a third of 6?
const hasExpression = function hasExpression(cb) {
  const expressionTerms = ['add', 'plus', 'and', '+', '-', 'minus', 'subtract', 'x', 'times', 'multiply', 'multiplied', 'of', 'divide', 'divided', '/', 'half', 'percent', '%'];

  const containsArithmeticTerm = _.some(this.message.words, word => expressionTerms.indexOf(word) !== -1);

  const burstSentence = this.message.words.join(" ");
  const nlp2 = nlp(burstSentence);
  this.message.numbers = nlp2.match('#Value').out('array');
  this.message.numbers = this.message.numbers.map(function(x){ return +x; });

  // Special case "half" is really .5 and a number
  if (_.indexOf(this.message.words, "half") !== -1) {
    this.message.numbers.push(.5);
  }
  const hasTwoNumbers = this.message.numbers.length >= 2;

  this.message.expression = (containsArithmeticTerm && hasTwoNumbers);
  cb();
};

const pennToWordnet = function pennToWordnet(pennTag) {
  if (pennTag[0] === 'J') {
    return 'a';
  } else if (pennTag[0] === 'V') {
    return 'v';
  } else if (pennTag[0] === 'N') {
    return 'n';
  } else if (pennTag[0] === 'R') {
    return 'r';
  }
  return null;
};

const fixup = function fixup(cb) {
  // fix numeric forms
  // twenty-one => 21
  this.message.clean = nlp(this.message.clean).values().toNumber().all().out('text');

  // singalize / lemmatize
  // This does a slightly better job than `.split(" ")`
  //this.message.words = lexer.lex(this.message.clean);
  const taggedWords = tagger.tag(this.message.words);

  const itor = (hash, next) => {
    const word = hash[0].toLowerCase();
    const tag = pennToWordnet(hash[1]);

    if (tag) {
      return Lemmer.lemmatize(`${word}#${tag}`, next);
    }
    // Some words don't have a tag ie: like, to.
    return next(null, [word]);
  };

  async.map(taggedWords, itor, (err, transformed) => {
    this.message.lemString = _.map(_.flatten(transformed), a => a.split('#')[0]).join(' ');
    cb();
  });
};

const addQuestionTypes = function addQuestionTypes(cb) {
  // Classify Question
  //const questionWords = ['who', 'whose', 'whom', 'what', 'where', 'when', 'why', 'which', 'name', 'did', 'do', 'does', 'have', 'had', 'has'];
  //let isQuestion = false;

  //if (this.message.raw.slice(-1) === '?') isQuestion = true;

  //if (this.message.words.length !== 0) {
  //  if (questionWords.indexOf(this.message.words[0].toLowerCase()) !== -1) {
  //    isQuestion = true;
  //  }
  //}
  //this.message.isQuestion = isQuestion;
  var output = this.message.cnlp[0].output;
  if (output[0].word == '是否')
    this.message.isQuestion = true;
  else if (output[output.lengh-1] == "嗎")
    this.message.isQuestion = true;
  cb();
};

// Order here matters
export default {
  addTags,
  //addChineseNlp,
  addChineseNlpFromJieba,
  addNlp,
  addEntities,
  addDates,
  addPos,
  addEmail,
  addWords,
  fixup,
  hasExpression,
  addQuestionTypes,
};
