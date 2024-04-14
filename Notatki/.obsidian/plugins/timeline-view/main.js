"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
const obsidian = require("obsidian");
const ALL_PROPERTY_TYPES = [
  "aliases",
  "multitext",
  "tags",
  "datetime",
  "date",
  "number",
  "checkbox",
  "text"
];
function isTypeOfProperty(type) {
  return ALL_PROPERTY_TYPES.includes(type);
}
const CREATED_PROPERTY = Object.freeze({
  name: "created",
  type: "datetime"
});
const MODIFIED_PROPERTY = Object.freeze({
  name: "modified",
  type: "datetime"
});
function properties(vault, metadataCache) {
  return new ObsidianProperties(vault, metadataCache);
}
class ObsidianProperties {
  constructor(vault, metadataCache) {
    __publicField(this, "subscriptions", {
      "property-created": [],
      "property-type-changed": [],
      "property-removed": []
    });
    __publicField(this, "knownProperties");
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.knownProperties = new MutablePropertyCollectionImpl({ created: "datetime", modified: "datetime" });
    loadRegisteredTypes(vault).then((registeredTypes) => {
      this.knownProperties = registeredTypes.asMutable();
    });
  }
  metadataChanged(file) {
    const knownProperties = this.knownProperties;
    if (knownProperties == null) {
      return;
    }
    const metadata = this.metadataCache.getFileCache(file);
    if (metadata == null) {
      return;
    }
    if (metadata.frontmatter == null) {
      return;
    }
    for (const propertyName of Object.keys(metadata.frontmatter)) {
      if (!(propertyName in knownProperties)) {
        this.loadRegisteredTypes();
        break;
      }
    }
  }
  async loadRegisteredTypes() {
    const knownProperties = this.listKnownProperties();
    const newTypes = (await loadRegisteredTypes(this.vault)).asMutable();
    let events = [];
    for (const property of newTypes.list()) {
      if (knownProperties.has(property.name)) {
        const oldType = knownProperties.typeOf(property.name);
        if (property.type != oldType) {
          events.push(() => {
            this.subscriptions["property-type-changed"].forEach(
              (subscription) => {
                subscription(property.name, oldType, property.type);
              }
            );
          });
        }
      } else {
        events.push(() => {
          this.subscriptions["property-created"].forEach(
            (subscription) => {
              subscription(property.name, property.type);
            }
          );
        });
      }
    }
    for (const property of knownProperties.list()) {
      if (!newTypes.has(property.name)) {
        events.push(() => {
          this.subscriptions["property-removed"].forEach(
            (subscription) => {
              subscription(property.name, property.type);
            }
          );
        });
      }
    }
    this.knownProperties = newTypes;
    events.forEach((event) => event());
  }
  listKnownProperties() {
    return this.knownProperties;
  }
  on(eventType, listener) {
    const subscriptions = this.subscriptions[eventType];
    subscriptions.push(listener);
    return () => {
      subscriptions.remove(listener);
    };
  }
}
async function loadRegisteredTypes(vault) {
  const registeredTypes = new MutablePropertyCollectionImpl({
    created: "datetime",
    modified: "datetime"
  });
  const rawText = await vault.adapter.read(`.obsidian/types.json`);
  const json = JSON.parse(rawText);
  if (!("types" in json)) {
    return registeredTypes;
  }
  const types = json.types;
  if (types === null || typeof types !== "object") {
    return registeredTypes;
  }
  for (const [propertyName, maybePropertyType] of Object.entries(types)) {
    if (isTypeOfProperty(maybePropertyType)) {
      registeredTypes.add(propertyName, maybePropertyType);
    }
  }
  return registeredTypes;
}
function filterByType(properties2, includedTypes) {
  let allMatch = true;
  const allProperties = properties2.list();
  for (const property of allProperties) {
    if (!includedTypes.includes(property.type)) {
      allMatch = false;
      break;
    }
  }
  if (allMatch) {
    return properties2;
  }
  const subset = properties2.toMutable();
  for (const property of allProperties) {
    if (!includedTypes.includes(property.type)) {
      subset.remove(property.name);
    }
  }
  return subset;
}
class PropertyCollectionImpl {
  constructor(properties2) {
    this.properties = properties2;
  }
  has(name) {
    return name in this.properties;
  }
  typeOf(name) {
    return this.properties[name];
  }
  keys() {
    return Object.keys(this.properties);
  }
  names() {
    return this.keys();
  }
  list() {
    const properties2 = [
      CREATED_PROPERTY,
      MODIFIED_PROPERTY
    ];
    for (const name of this.names()) {
      if (name === "created" || name === "modified")
        continue;
      const property = { name, type: this.properties[name] };
      properties2.push(property);
    }
    return properties2;
  }
  toMutable() {
    return new MutablePropertyCollectionImpl({ ...this.properties });
  }
  asMutable() {
    return this.toMutable();
  }
  asReadOnly() {
    return this;
  }
}
class MutablePropertyCollectionImpl extends PropertyCollectionImpl {
  constructor(mutableProperties) {
    super(mutableProperties);
    this.mutableProperties = mutableProperties;
  }
  add(name, type) {
    if (name === "created" || name === "modified") {
      return;
    }
    this.mutableProperties[name] = type;
  }
  addProperty(property) {
    this.add(property.name, property.type);
  }
  replace(name, type) {
    if (this.remove(name)) {
      this.add(name, type);
      return true;
    }
    return false;
  }
  remove(name) {
    if (name === "created" || name === "modified") {
      return false;
    }
    if (!this.has(name)) {
      return false;
    }
    delete this.mutableProperties[name];
    return true;
  }
  toReadOnly() {
    return new PropertyCollectionImpl({ ...this.mutableProperties });
  }
  asMutable() {
    return this;
  }
}
function isFileFilter(obj) {
  return obj != null && typeof obj === "object" && "appliesTo" in obj && typeof obj.appliesTo === "function";
}
function or(a, b) {
  a = Array.isArray(a) ? matchAll(a) : a;
  b = Array.isArray(b) ? matchAll(b) : b;
  return new OrFilter(a, b);
}
class OrFilter {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
  async appliesTo(file) {
    return await this.a.appliesTo(file) || await this.b.appliesTo(file);
  }
  and(filter) {
    return matchAll(this, filter);
  }
  or(filter) {
    return or(this, filter);
  }
}
function matchAll(...filters) {
  if (filters.length === 1) {
    if (Array.isArray(filters[0])) {
      return combine$1(filters[0]);
    }
  }
  return combine$1(filters);
}
function combine$1(filters) {
  if (filters.length === 1)
    return filters[0];
  if (filters.length === 0)
    return MatchNone;
  return MatchAllFilter.flattened(filters);
}
const MatchNone = {
  async appliesTo(file) {
    return false;
  },
  and(filter) {
    return this;
  },
  or(filter) {
    return filter;
  }
};
class MatchAllFilter {
  constructor(filters) {
    this.filters = filters;
  }
  static flattened(filters) {
    if (!filters.some((filter) => filter instanceof MatchAllFilter)) {
      return new MatchAllFilter(filters);
    }
    return new MatchAllFilter(
      filters.flatMap((filter) => {
        if (filter instanceof MatchAllFilter) {
          return filter.filters;
        }
        return [filter];
      })
    );
  }
  async appliesTo(file) {
    return Promise.all(
      this.filters.map((filter) => filter.appliesTo(file))
    ).then((all) => all.every((it) => it));
  }
  and(filter) {
    if (filter instanceof MatchAllFilter) {
      return new MatchAllFilter(this.filters.concat(filter.filters));
    }
    return new MatchAllFilter(
      this.filters.concat(filter)
    );
  }
  or(filter) {
    return or(this, filter);
  }
}
class FileContentFilter {
  constructor(checker) {
    this.checker = checker;
  }
  async appliesTo(file) {
    const content2 = await file.vault.cachedRead(file);
    return this.checker.matches(content2);
  }
  and(filter) {
    return matchAll(this, filter);
  }
  or(filter) {
    return or(this, filter);
  }
}
function isParentParser(parser) {
  return "containsNestedGroupParser" in parser && typeof parser.containsNestedGroupParser === "function";
}
function isStringChecker(obj) {
  return obj != null && typeof obj === "object" && "matches" in obj && typeof obj.matches === "function";
}
class FileNameFilter {
  constructor(checker) {
    this.checker = checker;
  }
  async appliesTo(file2) {
    return this.checker.matches(file2.basename);
  }
  and(filter) {
    return matchAll(this, filter);
  }
  or(filter) {
    return or(this, filter);
  }
}
class FilePathFilter {
  constructor(checker) {
    this.checker = checker;
  }
  async appliesTo(file) {
    return this.checker.matches(file.path);
  }
  and(filter) {
    return matchAll(this, filter);
  }
  or(filter) {
    return matchAll(this, filter);
  }
}
class Or {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
  matches(test) {
    return this.a.matches(test) || this.b.matches(test);
  }
  or(checker) {
    return new Or(this, checker);
  }
  and(checker) {
    return group(this, checker);
  }
}
function group(...checkers) {
  if (checkers.length === 1) {
    if (Array.isArray(checkers[0])) {
      return combine(checkers[0]);
    }
  }
  return combine(checkers);
}
function combine(checkers) {
  if (checkers.length === 1)
    return checkers[0];
  return new Group(checkers);
}
class Group {
  constructor(checkers) {
    this.checkers = checkers;
  }
  matches(test) {
    return this.checkers.every((checker) => checker.matches(test));
  }
  or(checker) {
    return new Or(this, checker);
  }
  and(checker) {
    return group(this.checkers.concat([checker]));
  }
}
class Phrase {
  constructor(phrase2, matchCase = true) {
    this.phrase = phrase2;
    this.matchCase = matchCase;
  }
  matches(test) {
    if (this.matchCase)
      return test.includes(this.phrase);
    return test.toLocaleUpperCase().includes(this.phrase.toLocaleUpperCase());
  }
  or(checker) {
    return new Or(this, checker);
  }
  and(checker) {
    return group(this, checker);
  }
}
class SubQueryPhraseParser {
  constructor(matchCase = true, buffer = "") {
    this.matchCase = matchCase;
    this.buffer = buffer;
  }
  parse(char) {
    switch (char) {
      case `\\`: {
        return new EscapedSubQueryPhraseParser(this.buffer, this.matchCase);
      }
      case `"`: {
        return null;
      }
    }
    return new SubQueryPhraseParser(this.matchCase, this.buffer + char);
  }
  end() {
    if (this.buffer.length > 0) {
      return new Phrase(this.buffer, this.matchCase);
    }
  }
}
class EscapedSubQueryPhraseParser extends SubQueryPhraseParser {
  constructor(buffer, matchCase = true) {
    super(matchCase, buffer);
  }
  parse(char) {
    return new SubQueryPhraseParser(
      this.matchCase,
      this.buffer + char
    );
  }
}
function not(checker) {
  if (checker instanceof Not) {
    return checker.not();
  }
  return new Not(checker);
}
class Not {
  constructor(checker) {
    this.checker = checker;
  }
  matches(test) {
    return !this.checker.matches(test);
  }
  not() {
    return this.checker;
  }
  or(checker) {
    return new Or(this, checker);
  }
  and(checker) {
    return group(this, checker);
  }
}
const Word = Phrase;
class SubQueryWordParser {
  constructor(buffer, matchCase) {
    this.buffer = buffer;
    this.matchCase = matchCase;
  }
  parse(char) {
    if (char === ` `) {
      return null;
    }
    return new SubQueryWordParser(
      this.buffer + char,
      this.matchCase
    );
  }
  end() {
    if (this.buffer.length > 0) {
      return new Word(this.buffer, this.matchCase);
    }
  }
}
class SubQueryEitherParser {
  constructor(aChecker, bChecker, matchCase, internalParser = new DefaultSubQueryParser(matchCase)) {
    this.aChecker = aChecker;
    this.bChecker = bChecker;
    this.matchCase = matchCase;
    this.internalParser = internalParser;
  }
  static start(aChecker, matchCase = true) {
    return new SubQueryEitherParser(
      aChecker,
      group(),
      matchCase
    );
  }
  parse(char) {
    const nextParser = this.internalParser.parse(char);
    if (nextParser == null) {
      return new SubQueryEitherParser(
        this.aChecker,
        this.nextChecker(),
        this.matchCase,
        new DefaultSubQueryParser(this.matchCase)
      );
    }
    return new SubQueryEitherParser(
      this.aChecker,
      this.bChecker,
      this.matchCase,
      nextParser
    );
  }
  nextChecker() {
    const next = this.internalParser.end();
    if (next != null) {
      return this.bChecker.and(next);
    }
    return this.bChecker;
  }
  end() {
    return this.aChecker.or(this.nextChecker());
  }
}
class SubQueryGroupParser {
  constructor(internalCheckers, internalParser, matchCase) {
    this.internalCheckers = internalCheckers;
    this.internalParser = internalParser;
    this.matchCase = matchCase;
  }
  static start(matchCase) {
    return new SubQueryGroupParser(
      [],
      new DefaultSubQueryParser(matchCase),
      matchCase
    );
  }
  parse(char) {
    if (char === `)` && !this.containsNestedGroupParser()) {
      return null;
    }
    const nextParser = this.internalParser.parse(char);
    if (nextParser != null) {
      return new SubQueryGroupParser(
        this.internalCheckers,
        nextParser,
        this.matchCase
      );
    } else {
      if (this.internalParser instanceof SubQueryWordParser) {
        switch (this.internalParser.buffer.toLocaleLowerCase()) {
          case "or": {
            return new SubQueryGroupParser(
              [],
              SubQueryEitherParser.start(
                group(this.internalCheckers),
                this.matchCase
              ),
              this.matchCase
            );
          }
          case "and": {
            return new SubQueryGroupParser(
              this.internalCheckers,
              new DefaultSubQueryParser(this.matchCase),
              this.matchCase
            );
          }
        }
      }
      return new SubQueryGroupParser(
        this.endInternalParser(),
        new DefaultSubQueryParser(this.matchCase),
        this.matchCase
      );
    }
  }
  containsNestedGroupParser() {
    return this.internalParser instanceof SubQueryGroupParser || isParentParser(this.internalParser) && this.internalParser.containsNestedGroupParser();
  }
  endInternalParser() {
    const checker = this.internalParser.end();
    if (checker != null) {
      return this.internalCheckers.concat([checker]);
    }
    return this.internalCheckers;
  }
  end() {
    return group(this.endInternalParser());
  }
}
class SubQueryNegatedParser {
  constructor(matchCase, internalParser = new DefaultSubQueryParser(matchCase)) {
    this.matchCase = matchCase;
    this.internalParser = internalParser;
  }
  parse(char) {
    const nextParser = this.internalParser.parse(char);
    if (nextParser == null) {
      return null;
    }
    return new SubQueryNegatedParser(this.matchCase, nextParser);
  }
  containsNestedGroupParser() {
    return this.internalParser instanceof SubQueryGroupParser || isParentParser(this.internalParser) && this.internalParser.containsNestedGroupParser();
  }
  end() {
    const result = this.internalParser.end();
    if (isStringChecker(result)) {
      return not(result);
    }
  }
}
class DefaultSubQueryParser {
  constructor(matchCase) {
    this.matchCase = matchCase;
  }
  parse(char) {
    switch (char) {
      case `-`: {
        return new SubQueryNegatedParser(this.matchCase);
      }
      case `"`: {
        return new SubQueryPhraseParser(this.matchCase);
      }
      case `(`: {
        return SubQueryGroupParser.start(this.matchCase);
      }
      case ` `: {
        return this;
      }
      default: {
        return new SubQueryWordParser(char, this.matchCase);
      }
    }
  }
  end() {
  }
}
class MetadataTagFilter {
  constructor(checker) {
    this.checker = checker;
  }
  appliesTo(metadata) {
    const tags = metadata == null ? void 0 : metadata.tags;
    if (tags != null) {
      if (tags.some((tag) => this.checker.matches(`#${tag.tag}`))) {
        return true;
      }
    }
    const frontmatter = metadata == null ? void 0 : metadata.frontmatter;
    if (frontmatter == null)
      return false;
    if (this.checkTags(frontmatter.tag)) {
      return true;
    }
    if (this.checkTags(frontmatter.tags)) {
      return true;
    }
    return false;
  }
  checkTags(tags) {
    if (tags == null) {
      return false;
    }
    if (typeof tags === "string") {
      const match = this.checker.matches(tags);
      return match;
    }
    if (Array.isArray(tags)) {
      const match = tags.some((tag) => this.checker.matches(tag));
      return match;
    }
  }
}
class FileTagsFilter {
  constructor(tagChecker, metadata) {
    __publicField(this, "metadataFilter");
    this.metadata = metadata;
    this.metadataFilter = new MetadataTagFilter(tagChecker);
  }
  async appliesTo(file) {
    const cache = this.metadata.getFileCache(file);
    return this.metadataFilter.appliesTo(cache);
  }
  and(filter) {
    return matchAll(this, filter);
  }
  or(filter) {
    return or(this, filter);
  }
}
class OperatorParser {
  constructor(operator, metadata, internalParser, matchCase) {
    this.operator = operator;
    this.metadata = metadata;
    this.internalParser = internalParser;
    this.matchCase = matchCase;
  }
  static start(operator, metadata, matchCase) {
    return new OperatorParser(
      operator,
      metadata,
      new DefaultSubQueryParser(matchCase),
      matchCase
    );
  }
  parse(char) {
    if (this.operator === "tag" && char === "#")
      return this;
    const nextParser = this.internalParser.parse(char);
    if (nextParser == null) {
      return null;
    }
    return new OperatorParser(
      this.operator,
      this.metadata,
      nextParser,
      this.matchCase
    );
  }
  containsNestedGroupParser() {
    return this.internalParser instanceof SubQueryGroupParser || isParentParser(this.internalParser) && this.internalParser.containsNestedGroupParser();
  }
  end(activeFilter) {
    const checker = this.internalParser.end();
    if (isStringChecker(checker)) {
      switch (this.operator) {
        case "file": {
          return activeFilter.and(new FileNameFilter(checker));
        }
        case "path": {
          return activeFilter.and(new FilePathFilter(checker));
        }
        case "content": {
          return activeFilter.and(new FileContentFilter(checker));
        }
        case "tag": {
          return activeFilter.and(
            new FileTagsFilter(checker, this.metadata)
          );
        }
      }
    }
    return activeFilter;
  }
}
class MetatdataPropertyFilter {
  constructor(property, value) {
    this.property = property;
    this.value = value;
  }
  appliesTo(metadata) {
    const properties2 = metadata == null ? void 0 : metadata.frontmatter;
    if (properties2 == null)
      return false;
    const keys = Object.keys(properties2).filter(
      (key) => this.property.matches(key)
    );
    if (keys.length === 0)
      return false;
    if (this.value == null)
      return true;
    return keys.some((key) => {
      var _a;
      const value = (_a = properties2[key]) == null ? void 0 : _a.toString();
      if (value == null)
        return false;
      return this.value.matches(value);
    });
  }
}
class FilePropertyFilter {
  constructor(metadata, property, value) {
    __publicField(this, "metadataFilter");
    this.metadata = metadata;
    this.metadataFilter = new MetatdataPropertyFilter(property, value);
  }
  async appliesTo(file) {
    const cache = this.metadata.getFileCache(file);
    return this.metadataFilter.appliesTo(cache);
  }
  and(filter) {
    return matchAll(this, filter);
  }
  or(filter) {
    return or(this, filter);
  }
}
function negate(filters) {
  if (Array.isArray(filters)) {
    return negateSingle(matchAll(filters));
  }
  return negateSingle(filters);
}
function negateSingle(filter) {
  if (filter instanceof Negation)
    return filter.negate();
  return new Negation(filter);
}
class Negation {
  constructor(negated) {
    this.negated = negated;
  }
  async appliesTo(file) {
    return !this.negated.appliesTo(file);
  }
  negate() {
    return this.negated;
  }
  and(filter) {
    return matchAll(this, filter);
  }
  or(filter) {
    return or(this, filter);
  }
}
class EitherPerser {
  constructor(metadata, filterType, matchCase, collectedBFilters = [], internalParser = new DefaultParser(metadata, filterType, matchCase)) {
    this.metadata = metadata;
    this.filterType = filterType;
    this.matchCase = matchCase;
    this.collectedBFilters = collectedBFilters;
    this.internalParser = internalParser;
  }
  static start(metadata, filterType, matchCase) {
    return new EitherPerser(metadata, filterType, matchCase);
  }
  parse(char) {
    const nextParser = this.internalParser.parse(char);
    if (nextParser == null) {
      const filterOrChecker = this.internalParser.end(EmtpyFilter);
      if (isFileFilter(filterOrChecker)) {
        return new EitherPerser(
          this.metadata,
          this.filterType,
          this.matchCase,
          this.collectedBFilters.concat([filterOrChecker])
        );
      }
      return new EitherPerser(
        this.metadata,
        this.filterType,
        this.matchCase
      );
    }
    return new EitherPerser(
      this.metadata,
      this.filterType,
      this.matchCase,
      this.collectedBFilters,
      nextParser
    );
  }
  end(activeFilter) {
    const filterOrChecker = this.internalParser.end(EmtpyFilter);
    if (isFileFilter(filterOrChecker)) {
      return activeFilter.or(matchAll(this.collectedBFilters.concat([filterOrChecker])));
    }
    return activeFilter;
  }
}
class WordParser {
  constructor(subParser, filterType, metadata, matchCase) {
    this.subParser = subParser;
    this.filterType = filterType;
    this.metadata = metadata;
    this.matchCase = matchCase;
  }
  static start(buffer, filterType, metadata, matchCase) {
    return new WordParser(
      new SubQueryWordParser(buffer, matchCase),
      filterType,
      metadata,
      matchCase
    );
  }
  get buffer() {
    return this.subParser.buffer;
  }
  parse(char) {
    if (char === `:`) {
      const buffer = this.subParser.buffer;
      switch (buffer) {
        case `file`:
        case `path`:
        case "content":
        case "tag": {
          return OperatorParser.start(buffer, this.metadata, this.matchCase);
        }
      }
      return new DefaultParser(this.metadata);
    }
    const nextParser = this.subParser.parse(char);
    if (nextParser == null) {
      switch (this.buffer.toLocaleLowerCase()) {
        case "or": {
          return EitherPerser.start(this.metadata, this.filterType, this.matchCase);
        }
        case "and": {
          return new DefaultParser(this.metadata);
        }
      }
      return null;
    }
    return new WordParser(
      nextParser,
      this.filterType,
      this.metadata,
      this.matchCase
    );
  }
  end(activeFilter) {
    const checker = this.subParser.end();
    if (checker != null) {
      return activeFilter.and(this.filterType(checker));
    }
    return activeFilter;
  }
}
class GroupParser {
  constructor(metadata, filterType, internalFilter, internalParser, matchCase) {
    this.metadata = metadata;
    this.filterType = filterType;
    this.internalFilter = internalFilter;
    this.internalParser = internalParser;
    this.matchCase = matchCase;
  }
  static start(metadata, filterType, matchCase) {
    return new GroupParser(
      metadata,
      filterType,
      EmtpyFilter,
      new DefaultParser(metadata, filterType, matchCase),
      matchCase
    );
  }
  parse(char) {
    if (char === `)` && !this.containsNestedGroupParser()) {
      return null;
    }
    const nextParser = this.internalParser.parse(char);
    if (nextParser != null) {
      return new GroupParser(
        this.metadata,
        this.filterType,
        this.internalFilter,
        nextParser,
        this.matchCase
      );
    } else {
      const filter = this.endInternalParser();
      return new GroupParser(
        this.metadata,
        this.filterType,
        filter,
        new DefaultParser(
          this.metadata,
          this.filterType,
          this.matchCase
        ),
        this.matchCase
      );
    }
  }
  containsNestedGroupParser() {
    return this.internalParser instanceof GroupParser || isParentParser(this.internalParser) && this.internalParser.containsNestedGroupParser();
  }
  endInternalParser() {
    const filter = this.internalParser.end(this.internalFilter);
    if (isFileFilter(filter)) {
      return filter;
    }
    return this.internalFilter;
  }
  end(activeFilter) {
    const filter = this.endInternalParser();
    return activeFilter.and(filter);
  }
}
class NegatedParser {
  constructor(metadata, filterType, internalParser, matchCase) {
    this.metadata = metadata;
    this.filterType = filterType;
    this.internalParser = internalParser;
    this.matchCase = matchCase;
  }
  static start(metadata, filterType, matchCase) {
    return new NegatedParser(
      metadata,
      filterType,
      new DefaultParser(metadata, filterType, matchCase),
      matchCase
    );
  }
  parse(char) {
    const nextParser = this.internalParser.parse(char);
    if (nextParser == null) {
      return null;
    }
    return new NegatedParser(
      this.metadata,
      this.filterType,
      nextParser,
      this.matchCase
    );
  }
  containsNestedGroupParser() {
    return this.internalParser instanceof GroupParser || isParentParser(this.internalParser) && this.internalParser.containsNestedGroupParser();
  }
  end(activeFilter) {
    const result = this.internalParser.end(EmtpyFilter);
    if (isFileFilter(result)) {
      return activeFilter.and(negate(result));
    }
    return activeFilter;
  }
}
class PhraseParser {
  constructor(filterType, matchCase = true) {
    __publicField(this, "subParser");
    this.filterType = filterType;
    this.subParser = new SubQueryPhraseParser(matchCase);
  }
  parse(char) {
    const nextParser = this.subParser.parse(char);
    if (nextParser == null) {
      return null;
    }
    this.subParser = nextParser;
    return this;
  }
  end(activeFilter) {
    const checker = this.subParser.end();
    if (checker != null) {
      return activeFilter.and(this.filterType(checker));
    }
    return activeFilter;
  }
}
function regex(regex2, matchCase = false) {
  if (typeof regex2 === "string" || regex2 instanceof RegExp) {
    return new Regex(new RegExp(regex2));
  }
  return new Regex(new RegExp(regex2.join("")));
}
class Regex {
  constructor(regex2, matchCase = false) {
    __publicField(this, "regex");
    if (matchCase && regex2.flags.includes("i")) {
      this.regex = new RegExp(regex2, regex2.flags.split("").filter((it) => it !== "i").join(""));
    } else if (!matchCase && !regex2.flags.includes("i")) {
      this.regex = new RegExp(regex2, regex2.flags + "i");
    } else {
      this.regex = regex2;
    }
  }
  matches(test) {
    return this.regex.test(test);
  }
  or(checker) {
    return new Or(this, checker);
  }
  and(checker) {
    return group(this, checker);
  }
}
class SubQueryRegexParser {
  constructor(matchCase = true) {
    __publicField(this, "escaped", false);
    __publicField(this, "buffer", "");
    this.matchCase = matchCase;
  }
  parse(char) {
    switch (char) {
      case `\\`: {
        if (!this.escaped) {
          this.escaped = true;
          return this;
        }
      }
      case `/`: {
        if (!this.escaped) {
          return null;
        }
      }
    }
    this.escaped = false;
    this.buffer += char;
    return this;
  }
  end() {
    if (this.buffer.length > 0) {
      return regex(this.buffer, this.matchCase);
    }
  }
}
class RegexParser {
  constructor(filterType, matchCase = true) {
    __publicField(this, "subParser");
    this.filterType = filterType;
    this.subParser = new SubQueryRegexParser(matchCase);
  }
  parse(char) {
    const nextParser = this.subParser.parse(char);
    if (nextParser == null) {
      return null;
    }
    this.subParser = nextParser;
    return this;
  }
  end(activeFilter) {
    const checker = this.subParser.end();
    if (checker != null) {
      return activeFilter.and(this.filterType(checker));
    }
    return activeFilter;
  }
}
function parseProperty(metadata) {
  return new PropertyNameParser([], metadata);
}
class PropertyNameParser {
  constructor(checkers, metadata, parser = new DefaultSubQueryParser()) {
    this.checkers = checkers;
    this.metadata = metadata;
    this.parser = parser;
  }
  parse(char) {
    if (char === `]`) {
      return null;
    }
    if (char === `:`) {
      return new PropertyValueParser(
        group(this.endInternalParser()),
        this.metadata
      );
    }
    const next = this.parser.parse(char);
    if (next == null) {
      return new PropertyNameParser(
        this.endInternalParser(),
        this.metadata
      );
    }
    return new PropertyNameParser(this.checkers, this.metadata, next);
  }
  endInternalParser() {
    const checker = this.parser.end();
    if (checker != null) {
      return this.checkers.concat([checker]);
    }
    return this.checkers;
  }
  end(activeFilter) {
    return activeFilter.and(
      new FilePropertyFilter(
        this.metadata,
        group(this.endInternalParser())
      )
    );
  }
}
class PropertyValueParser {
  constructor(property, metadata, checkers = [], parser = new DefaultSubQueryParser()) {
    this.property = property;
    this.metadata = metadata;
    this.checkers = checkers;
    this.parser = parser;
  }
  parse(char) {
    if (char === `]`) {
      return null;
    }
    const next = this.parser.parse(char);
    if (next == null) {
      return new PropertyValueParser(
        this.property,
        this.metadata,
        this.endInternalParser(),
        new DefaultSubQueryParser()
      );
    }
    return new PropertyValueParser(
      this.property,
      this.metadata,
      this.checkers,
      next
    );
  }
  endInternalParser() {
    const checker = this.parser.end();
    if (checker != null) {
      return this.checkers.concat([checker]);
    }
    return this.checkers;
  }
  end(activeFilter) {
    return activeFilter.and(
      new FilePropertyFilter(
        this.metadata,
        this.property,
        group(this.endInternalParser())
      )
    );
  }
}
class DefaultParser {
  constructor(metadata, filterType = (checker) => new FileContentFilter(checker), matchCase) {
    this.metadata = metadata;
    this.filterType = filterType;
    this.matchCase = matchCase;
  }
  parse(char) {
    switch (char) {
      case `-`: {
        return NegatedParser.start(this.metadata, this.filterType, this.matchCase);
      }
      case `"`: {
        return new PhraseParser(this.filterType, this.matchCase);
      }
      case `/`: {
        return new RegexParser(this.filterType, this.matchCase);
      }
      case `(`: {
        return GroupParser.start(this.metadata, this.filterType, this.matchCase);
      }
      case `[`: {
        return parseProperty(this.metadata);
      }
      case ` `: {
        return null;
      }
      default: {
        return WordParser.start(char, this.filterType, this.metadata, this.matchCase);
      }
    }
  }
  end(activeFilter) {
    return activeFilter;
  }
}
const EmtpyFilter = {
  async appliesTo(file) {
    return false;
  },
  and(filter) {
    return filter;
  },
  or(filter) {
    return filter;
  }
};
function parse(query, metadata, filter = EmtpyFilter) {
  query = query.trim();
  let parser = new DefaultParser(metadata);
  for (const char of query) {
    const nextParser = parser.parse(char);
    if (nextParser == null) {
      const checker2 = parser.end(filter);
      if (isFileFilter(checker2)) {
        filter = checker2;
      }
      parser = new DefaultParser(metadata);
    } else {
      parser = nextParser;
    }
  }
  const checker = parser.end(filter);
  if (isFileFilter(checker)) {
    return checker;
  }
  return filter;
}
class Note {
  constructor(tFile, metadataCache) {
    this.tFile = tFile;
    this.metadataCache = metadataCache;
  }
  path() {
    return this.tFile.path;
  }
  nameWithoutExtension() {
    return this.tFile.basename;
  }
  createdAt() {
    return this.tFile.stat.ctime;
  }
  modifiedAt() {
    return this.tFile.stat.mtime;
  }
  metadata() {
    var _a, _b;
    return (_b = (_a = this.metadataCache.getFileCache(this.tFile)) == null ? void 0 : _a.frontmatter) != null ? _b : null;
  }
  matches(filter) {
    return filter.appliesTo(this.tFile);
  }
  openIn(leaf) {
    return leaf.openFile(this.tFile);
  }
}
function files(vault, metadata) {
  return new ObsidianFiles(vault, metadata);
}
class ObsidianFiles {
  constructor(vault, metadata) {
    __publicField(this, "subscriptions", {
      "created": [],
      "renamed": [],
      "modified": [],
      "deleted": []
    });
    this.vault = vault;
    this.metadata = metadata;
  }
  async list() {
    return this.vault.getMarkdownFiles().map((tFile) => new Note(tFile, this.metadata));
  }
  parseFilter(query, defaultFilter) {
    return parse(query, this.metadata, defaultFilter);
  }
  on(eventType, listener) {
    const subscriptions = this.subscriptions[eventType];
    subscriptions.push(listener);
    return () => {
      subscriptions.remove(listener);
    };
  }
  fileCreated(file) {
    if (!(file instanceof obsidian.TFile)) {
      return;
    }
    const listeners = this.subscriptions["created"];
    for (const listener of listeners) {
      listener(new Note(file, this.metadata));
    }
  }
  fileRenamed(file, oldPath) {
    if (!(file instanceof obsidian.TFile)) {
      return;
    }
    const listeners = this.subscriptions["renamed"];
    for (const listener of listeners) {
      listener(new Note(file, this.metadata), oldPath);
    }
  }
  fileModified(file) {
    if (!(file instanceof obsidian.TFile)) {
      return;
    }
    const listeners = this.subscriptions["modified"];
    for (const listener of listeners) {
      listener(new Note(file, this.metadata));
    }
  }
  fileDeleted(file) {
    if (!(file instanceof obsidian.TFile)) {
      return;
    }
    const listeners = this.subscriptions["deleted"];
    for (const listener of listeners) {
      listener(new Note(file, this.metadata));
    }
  }
}
function noop() {
}
const identity = (x) => x;
function assign(tar, src) {
  for (const k in src)
    tar[k] = src[k];
  return (
    /** @type {T & S} */
    tar
  );
}
function run(fn) {
  return fn();
}
function blank_object() {
  return /* @__PURE__ */ Object.create(null);
}
function run_all(fns) {
  fns.forEach(run);
}
function is_function(thing) {
  return typeof thing === "function";
}
function safe_not_equal(a, b) {
  return a != a ? b == b : a !== b || a && typeof a === "object" || typeof a === "function";
}
function is_empty(obj) {
  return Object.keys(obj).length === 0;
}
function subscribe(store, ...callbacks) {
  if (store == null) {
    for (const callback of callbacks) {
      callback(void 0);
    }
    return noop;
  }
  const unsub = store.subscribe(...callbacks);
  return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function get_store_value(store) {
  let value;
  subscribe(store, (_) => value = _)();
  return value;
}
function component_subscribe(component, store, callback) {
  component.$$.on_destroy.push(subscribe(store, callback));
}
function create_slot(definition, ctx, $$scope, fn) {
  if (definition) {
    const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
    return definition[0](slot_ctx);
  }
}
function get_slot_context(definition, ctx, $$scope, fn) {
  return definition[1] && fn ? assign($$scope.ctx.slice(), definition[1](fn(ctx))) : $$scope.ctx;
}
function get_slot_changes(definition, $$scope, dirty, fn) {
  if (definition[2] && fn) {
    const lets = definition[2](fn(dirty));
    if ($$scope.dirty === void 0) {
      return lets;
    }
    if (typeof lets === "object") {
      const merged = [];
      const len = Math.max($$scope.dirty.length, lets.length);
      for (let i = 0; i < len; i += 1) {
        merged[i] = $$scope.dirty[i] | lets[i];
      }
      return merged;
    }
    return $$scope.dirty | lets;
  }
  return $$scope.dirty;
}
function update_slot_base(slot, slot_definition, ctx, $$scope, slot_changes, get_slot_context_fn) {
  if (slot_changes) {
    const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
    slot.p(slot_context, slot_changes);
  }
}
function get_all_dirty_from_scope($$scope) {
  if ($$scope.ctx.length > 32) {
    const dirty = [];
    const length = $$scope.ctx.length / 32;
    for (let i = 0; i < length; i++) {
      dirty[i] = -1;
    }
    return dirty;
  }
  return -1;
}
function exclude_internal_props(props) {
  const result = {};
  for (const k in props)
    if (k[0] !== "$")
      result[k] = props[k];
  return result;
}
function compute_rest_props(props, keys) {
  const rest = {};
  keys = new Set(keys);
  for (const k in props)
    if (!keys.has(k) && k[0] !== "$")
      rest[k] = props[k];
  return rest;
}
function set_store_value(store, ret, value) {
  store.set(value);
  return ret;
}
const is_client = typeof window !== "undefined";
let now = is_client ? () => window.performance.now() : () => Date.now();
let raf = is_client ? (cb) => requestAnimationFrame(cb) : noop;
const tasks = /* @__PURE__ */ new Set();
function run_tasks(now2) {
  tasks.forEach((task) => {
    if (!task.c(now2)) {
      tasks.delete(task);
      task.f();
    }
  });
  if (tasks.size !== 0)
    raf(run_tasks);
}
function loop(callback) {
  let task;
  if (tasks.size === 0)
    raf(run_tasks);
  return {
    promise: new Promise((fulfill) => {
      tasks.add(task = { c: callback, f: fulfill });
    }),
    abort() {
      tasks.delete(task);
    }
  };
}
const globals = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : (
  // @ts-ignore Node typings have this
  global
);
function append(target, node) {
  target.appendChild(node);
}
function get_root_for_style(node) {
  if (!node)
    return document;
  const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
  if (root && /** @type {ShadowRoot} */
  root.host) {
    return (
      /** @type {ShadowRoot} */
      root
    );
  }
  return node.ownerDocument;
}
function append_empty_stylesheet(node) {
  const style_element = element("style");
  style_element.textContent = "/* empty */";
  append_stylesheet(get_root_for_style(node), style_element);
  return style_element.sheet;
}
function append_stylesheet(node, style) {
  append(
    /** @type {Document} */
    node.head || node,
    style
  );
  return style.sheet;
}
function insert(target, node, anchor) {
  target.insertBefore(node, anchor || null);
}
function detach(node) {
  if (node.parentNode) {
    node.parentNode.removeChild(node);
  }
}
function destroy_each(iterations, detaching) {
  for (let i = 0; i < iterations.length; i += 1) {
    if (iterations[i])
      iterations[i].d(detaching);
  }
}
function element(name) {
  return document.createElement(name);
}
function svg_element(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}
function text(data) {
  return document.createTextNode(data);
}
function space() {
  return text(" ");
}
function empty() {
  return text("");
}
function listen(node, event, handler, options) {
  node.addEventListener(event, handler, options);
  return () => node.removeEventListener(event, handler, options);
}
function prevent_default(fn) {
  return function(event) {
    event.preventDefault();
    return fn.call(this, event);
  };
}
function stop_propagation(fn) {
  return function(event) {
    event.stopPropagation();
    return fn.call(this, event);
  };
}
function self(fn) {
  return function(event) {
    if (event.target === this)
      fn.call(this, event);
  };
}
function attr(node, attribute, value) {
  if (value == null)
    node.removeAttribute(attribute);
  else if (node.getAttribute(attribute) !== value)
    node.setAttribute(attribute, value);
}
const always_set_through_set_attribute = ["width", "height"];
function set_attributes(node, attributes) {
  const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
  for (const key in attributes) {
    if (attributes[key] == null) {
      node.removeAttribute(key);
    } else if (key === "style") {
      node.style.cssText = attributes[key];
    } else if (key === "__value") {
      node.value = node[key] = attributes[key];
    } else if (descriptors[key] && descriptors[key].set && always_set_through_set_attribute.indexOf(key) === -1) {
      node[key] = attributes[key];
    } else {
      attr(node, key, attributes[key]);
    }
  }
}
function children(element2) {
  return Array.from(element2.childNodes);
}
function set_data(text2, data) {
  data = "" + data;
  if (text2.data === data)
    return;
  text2.data = /** @type {string} */
  data;
}
function set_input_value(input, value) {
  input.value = value == null ? "" : value;
}
function set_style(node, key, value, important) {
  if (value == null) {
    node.style.removeProperty(key);
  } else {
    node.style.setProperty(key, value, important ? "important" : "");
  }
}
let crossorigin;
function is_crossorigin() {
  if (crossorigin === void 0) {
    crossorigin = false;
    try {
      if (typeof window !== "undefined" && window.parent) {
        void window.parent.document;
      }
    } catch (error) {
      crossorigin = true;
    }
  }
  return crossorigin;
}
function add_iframe_resize_listener(node, fn) {
  const computed_style = getComputedStyle(node);
  if (computed_style.position === "static") {
    node.style.position = "relative";
  }
  const iframe = element("iframe");
  iframe.setAttribute(
    "style",
    "display: block; position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; border: 0; opacity: 0; pointer-events: none; z-index: -1;"
  );
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  const crossorigin2 = is_crossorigin();
  let unsubscribe;
  if (crossorigin2) {
    iframe.src = "data:text/html,<script>onresize=function(){parent.postMessage(0,'*')}<\/script>";
    unsubscribe = listen(
      window,
      "message",
      /** @param {MessageEvent} event */
      (event) => {
        if (event.source === iframe.contentWindow)
          fn();
      }
    );
  } else {
    iframe.src = "about:blank";
    iframe.onload = () => {
      unsubscribe = listen(iframe.contentWindow, "resize", fn);
      fn();
    };
  }
  append(node, iframe);
  return () => {
    if (crossorigin2) {
      unsubscribe();
    } else if (unsubscribe && iframe.contentWindow) {
      unsubscribe();
    }
    detach(iframe);
  };
}
function toggle_class(element2, name, toggle) {
  element2.classList.toggle(name, !!toggle);
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
  return new CustomEvent(type, { detail, bubbles, cancelable });
}
const managed_styles = /* @__PURE__ */ new Map();
let active = 0;
function hash(str) {
  let hash2 = 5381;
  let i = str.length;
  while (i--)
    hash2 = (hash2 << 5) - hash2 ^ str.charCodeAt(i);
  return hash2 >>> 0;
}
function create_style_information(doc, node) {
  const info = { stylesheet: append_empty_stylesheet(node), rules: {} };
  managed_styles.set(doc, info);
  return info;
}
function create_rule(node, a, b, duration, delay, ease, fn, uid = 0) {
  const step = 16.666 / duration;
  let keyframes = "{\n";
  for (let p = 0; p <= 1; p += step) {
    const t = a + (b - a) * ease(p);
    keyframes += p * 100 + `%{${fn(t, 1 - t)}}
`;
  }
  const rule = keyframes + `100% {${fn(b, 1 - b)}}
}`;
  const name = `__svelte_${hash(rule)}_${uid}`;
  const doc = get_root_for_style(node);
  const { stylesheet, rules } = managed_styles.get(doc) || create_style_information(doc, node);
  if (!rules[name]) {
    rules[name] = true;
    stylesheet.insertRule(`@keyframes ${name} ${rule}`, stylesheet.cssRules.length);
  }
  const animation = node.style.animation || "";
  node.style.animation = `${animation ? `${animation}, ` : ""}${name} ${duration}ms linear ${delay}ms 1 both`;
  active += 1;
  return name;
}
function delete_rule(node, name) {
  const previous = (node.style.animation || "").split(", ");
  const next = previous.filter(
    name ? (anim) => anim.indexOf(name) < 0 : (anim) => anim.indexOf("__svelte") === -1
    // remove all Svelte animations
  );
  const deleted = previous.length - next.length;
  if (deleted) {
    node.style.animation = next.join(", ");
    active -= deleted;
    if (!active)
      clear_rules();
  }
}
function clear_rules() {
  raf(() => {
    if (active)
      return;
    managed_styles.forEach((info) => {
      const { ownerNode } = info.stylesheet;
      if (ownerNode)
        detach(ownerNode);
    });
    managed_styles.clear();
  });
}
let current_component;
function set_current_component(component) {
  current_component = component;
}
function get_current_component() {
  if (!current_component)
    throw new Error("Function called outside component initialization");
  return current_component;
}
function onMount(fn) {
  get_current_component().$$.on_mount.push(fn);
}
function createEventDispatcher() {
  const component = get_current_component();
  return (type, detail, { cancelable = false } = {}) => {
    const callbacks = component.$$.callbacks[type];
    if (callbacks) {
      const event = custom_event(
        /** @type {string} */
        type,
        detail,
        { cancelable }
      );
      callbacks.slice().forEach((fn) => {
        fn.call(component, event);
      });
      return !event.defaultPrevented;
    }
    return true;
  };
}
function bubble(component, event) {
  const callbacks = component.$$.callbacks[event.type];
  if (callbacks) {
    callbacks.slice().forEach((fn) => fn.call(this, event));
  }
}
const dirty_components = [];
const binding_callbacks = [];
let render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = /* @__PURE__ */ Promise.resolve();
let update_scheduled = false;
function schedule_update() {
  if (!update_scheduled) {
    update_scheduled = true;
    resolved_promise.then(flush);
  }
}
function add_render_callback(fn) {
  render_callbacks.push(fn);
}
function add_flush_callback(fn) {
  flush_callbacks.push(fn);
}
const seen_callbacks = /* @__PURE__ */ new Set();
let flushidx = 0;
function flush() {
  if (flushidx !== 0) {
    return;
  }
  const saved_component = current_component;
  do {
    try {
      while (flushidx < dirty_components.length) {
        const component = dirty_components[flushidx];
        flushidx++;
        set_current_component(component);
        update(component.$$);
      }
    } catch (e) {
      dirty_components.length = 0;
      flushidx = 0;
      throw e;
    }
    set_current_component(null);
    dirty_components.length = 0;
    flushidx = 0;
    while (binding_callbacks.length)
      binding_callbacks.pop()();
    for (let i = 0; i < render_callbacks.length; i += 1) {
      const callback = render_callbacks[i];
      if (!seen_callbacks.has(callback)) {
        seen_callbacks.add(callback);
        callback();
      }
    }
    render_callbacks.length = 0;
  } while (dirty_components.length);
  while (flush_callbacks.length) {
    flush_callbacks.pop()();
  }
  update_scheduled = false;
  seen_callbacks.clear();
  set_current_component(saved_component);
}
function update($$) {
  if ($$.fragment !== null) {
    $$.update();
    run_all($$.before_update);
    const dirty = $$.dirty;
    $$.dirty = [-1];
    $$.fragment && $$.fragment.p($$.ctx, dirty);
    $$.after_update.forEach(add_render_callback);
  }
}
function flush_render_callbacks(fns) {
  const filtered = [];
  const targets = [];
  render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
  targets.forEach((c) => c());
  render_callbacks = filtered;
}
let promise;
function wait() {
  if (!promise) {
    promise = Promise.resolve();
    promise.then(() => {
      promise = null;
    });
  }
  return promise;
}
function dispatch(node, direction, kind) {
  node.dispatchEvent(custom_event(`${direction ? "intro" : "outro"}${kind}`));
}
const outroing = /* @__PURE__ */ new Set();
let outros;
function group_outros() {
  outros = {
    r: 0,
    c: [],
    p: outros
    // parent group
  };
}
function check_outros() {
  if (!outros.r) {
    run_all(outros.c);
  }
  outros = outros.p;
}
function transition_in(block, local) {
  if (block && block.i) {
    outroing.delete(block);
    block.i(local);
  }
}
function transition_out(block, local, detach2, callback) {
  if (block && block.o) {
    if (outroing.has(block))
      return;
    outroing.add(block);
    outros.c.push(() => {
      outroing.delete(block);
      if (callback) {
        if (detach2)
          block.d(1);
        callback();
      }
    });
    block.o(local);
  } else if (callback) {
    callback();
  }
}
const null_transition = { duration: 0 };
function create_bidirectional_transition(node, fn, params, intro) {
  const options = { direction: "both" };
  let config = fn(node, params, options);
  let t = intro ? 0 : 1;
  let running_program = null;
  let pending_program = null;
  let animation_name = null;
  let original_inert_value;
  function clear_animation() {
    if (animation_name)
      delete_rule(node, animation_name);
  }
  function init2(program, duration) {
    const d = (
      /** @type {Program['d']} */
      program.b - t
    );
    duration *= Math.abs(d);
    return {
      a: t,
      b: program.b,
      d,
      duration,
      start: program.start,
      end: program.start + duration,
      group: program.group
    };
  }
  function go(b) {
    const {
      delay = 0,
      duration = 300,
      easing = identity,
      tick = noop,
      css
    } = config || null_transition;
    const program = {
      start: now() + delay,
      b
    };
    if (!b) {
      program.group = outros;
      outros.r += 1;
    }
    if ("inert" in node) {
      if (b) {
        if (original_inert_value !== void 0) {
          node.inert = original_inert_value;
        }
      } else {
        original_inert_value = /** @type {HTMLElement} */
        node.inert;
        node.inert = true;
      }
    }
    if (running_program || pending_program) {
      pending_program = program;
    } else {
      if (css) {
        clear_animation();
        animation_name = create_rule(node, t, b, duration, delay, easing, css);
      }
      if (b)
        tick(0, 1);
      running_program = init2(program, duration);
      add_render_callback(() => dispatch(node, b, "start"));
      loop((now2) => {
        if (pending_program && now2 > pending_program.start) {
          running_program = init2(pending_program, duration);
          pending_program = null;
          dispatch(node, running_program.b, "start");
          if (css) {
            clear_animation();
            animation_name = create_rule(
              node,
              t,
              running_program.b,
              running_program.duration,
              0,
              easing,
              config.css
            );
          }
        }
        if (running_program) {
          if (now2 >= running_program.end) {
            tick(t = running_program.b, 1 - t);
            dispatch(node, running_program.b, "end");
            if (!pending_program) {
              if (running_program.b) {
                clear_animation();
              } else {
                if (!--running_program.group.r)
                  run_all(running_program.group.c);
              }
            }
            running_program = null;
          } else if (now2 >= running_program.start) {
            const p = now2 - running_program.start;
            t = running_program.a + running_program.d * easing(p / running_program.duration);
            tick(t, 1 - t);
          }
        }
        return !!(running_program || pending_program);
      });
    }
  }
  return {
    run(b) {
      if (is_function(config)) {
        wait().then(() => {
          const opts = { direction: b ? "in" : "out" };
          config = config(opts);
          go(b);
        });
      } else {
        go(b);
      }
    },
    end() {
      clear_animation();
      running_program = pending_program = null;
    }
  };
}
function ensure_array_like(array_like_or_iterator) {
  return (array_like_or_iterator == null ? void 0 : array_like_or_iterator.length) !== void 0 ? array_like_or_iterator : Array.from(array_like_or_iterator);
}
function outro_and_destroy_block(block, lookup) {
  transition_out(block, 1, 1, () => {
    lookup.delete(block.key);
  });
}
function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block2, next, get_context) {
  let o = old_blocks.length;
  let n = list.length;
  let i = o;
  const old_indexes = {};
  while (i--)
    old_indexes[old_blocks[i].key] = i;
  const new_blocks = [];
  const new_lookup = /* @__PURE__ */ new Map();
  const deltas = /* @__PURE__ */ new Map();
  const updates = [];
  i = n;
  while (i--) {
    const child_ctx = get_context(ctx, list, i);
    const key = get_key(child_ctx);
    let block = lookup.get(key);
    if (!block) {
      block = create_each_block2(key, child_ctx);
      block.c();
    } else if (dynamic) {
      updates.push(() => block.p(child_ctx, dirty));
    }
    new_lookup.set(key, new_blocks[i] = block);
    if (key in old_indexes)
      deltas.set(key, Math.abs(i - old_indexes[key]));
  }
  const will_move = /* @__PURE__ */ new Set();
  const did_move = /* @__PURE__ */ new Set();
  function insert2(block) {
    transition_in(block, 1);
    block.m(node, next);
    lookup.set(block.key, block);
    next = block.first;
    n--;
  }
  while (o && n) {
    const new_block = new_blocks[n - 1];
    const old_block = old_blocks[o - 1];
    const new_key = new_block.key;
    const old_key = old_block.key;
    if (new_block === old_block) {
      next = new_block.first;
      o--;
      n--;
    } else if (!new_lookup.has(old_key)) {
      destroy(old_block, lookup);
      o--;
    } else if (!lookup.has(new_key) || will_move.has(new_key)) {
      insert2(new_block);
    } else if (did_move.has(old_key)) {
      o--;
    } else if (deltas.get(new_key) > deltas.get(old_key)) {
      did_move.add(new_key);
      insert2(new_block);
    } else {
      will_move.add(old_key);
      o--;
    }
  }
  while (o--) {
    const old_block = old_blocks[o];
    if (!new_lookup.has(old_block.key))
      destroy(old_block, lookup);
  }
  while (n)
    insert2(new_blocks[n - 1]);
  run_all(updates);
  return new_blocks;
}
function get_spread_update(levels, updates) {
  const update2 = {};
  const to_null_out = {};
  const accounted_for = { $$scope: 1 };
  let i = levels.length;
  while (i--) {
    const o = levels[i];
    const n = updates[i];
    if (n) {
      for (const key in o) {
        if (!(key in n))
          to_null_out[key] = 1;
      }
      for (const key in n) {
        if (!accounted_for[key]) {
          update2[key] = n[key];
          accounted_for[key] = 1;
        }
      }
      levels[i] = n;
    } else {
      for (const key in o) {
        accounted_for[key] = 1;
      }
    }
  }
  for (const key in to_null_out) {
    if (!(key in update2))
      update2[key] = void 0;
  }
  return update2;
}
function bind(component, name, callback) {
  const index = component.$$.props[name];
  if (index !== void 0) {
    component.$$.bound[index] = callback;
    callback(component.$$.ctx[index]);
  }
}
function create_component(block) {
  block && block.c();
}
function mount_component(component, target, anchor) {
  const { fragment, after_update } = component.$$;
  fragment && fragment.m(target, anchor);
  add_render_callback(() => {
    const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
    if (component.$$.on_destroy) {
      component.$$.on_destroy.push(...new_on_destroy);
    } else {
      run_all(new_on_destroy);
    }
    component.$$.on_mount = [];
  });
  after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
  const $$ = component.$$;
  if ($$.fragment !== null) {
    flush_render_callbacks($$.after_update);
    run_all($$.on_destroy);
    $$.fragment && $$.fragment.d(detaching);
    $$.on_destroy = $$.fragment = null;
    $$.ctx = [];
  }
}
function make_dirty(component, i) {
  if (component.$$.dirty[0] === -1) {
    dirty_components.push(component);
    schedule_update();
    component.$$.dirty.fill(0);
  }
  component.$$.dirty[i / 31 | 0] |= 1 << i % 31;
}
function init(component, options, instance2, create_fragment2, not_equal, props, append_styles, dirty = [-1]) {
  const parent_component = current_component;
  set_current_component(component);
  const $$ = component.$$ = {
    fragment: null,
    ctx: [],
    // state
    props,
    update: noop,
    not_equal,
    bound: blank_object(),
    // lifecycle
    on_mount: [],
    on_destroy: [],
    on_disconnect: [],
    before_update: [],
    after_update: [],
    context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
    // everything else
    callbacks: blank_object(),
    dirty,
    skip_bound: false,
    root: options.target || parent_component.$$.root
  };
  append_styles && append_styles($$.root);
  let ready = false;
  $$.ctx = instance2 ? instance2(component, options.props || {}, (i, ret, ...rest) => {
    const value = rest.length ? rest[0] : ret;
    if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
      if (!$$.skip_bound && $$.bound[i])
        $$.bound[i](value);
      if (ready)
        make_dirty(component, i);
    }
    return ret;
  }) : [];
  $$.update();
  ready = true;
  run_all($$.before_update);
  $$.fragment = create_fragment2 ? create_fragment2($$.ctx) : false;
  if (options.target) {
    if (options.hydrate) {
      const nodes = children(options.target);
      $$.fragment && $$.fragment.l(nodes);
      nodes.forEach(detach);
    } else {
      $$.fragment && $$.fragment.c();
    }
    if (options.intro)
      transition_in(component.$$.fragment);
    mount_component(component, options.target, options.anchor);
    flush();
  }
  set_current_component(parent_component);
}
class SvelteComponent {
  constructor() {
    /**
     * ### PRIVATE API
     *
     * Do not use, may change at any time
     *
     * @type {any}
     */
    __publicField(this, "$$");
    /**
     * ### PRIVATE API
     *
     * Do not use, may change at any time
     *
     * @type {any}
     */
    __publicField(this, "$$set");
  }
  /** @returns {void} */
  $destroy() {
    destroy_component(this, 1);
    this.$destroy = noop;
  }
  /**
   * @template {Extract<keyof Events, string>} K
   * @param {K} type
   * @param {((e: Events[K]) => void) | null | undefined} callback
   * @returns {() => void}
   */
  $on(type, callback) {
    if (!is_function(callback)) {
      return noop;
    }
    const callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
    callbacks.push(callback);
    return () => {
      const index = callbacks.indexOf(callback);
      if (index !== -1)
        callbacks.splice(index, 1);
    };
  }
  /**
   * @param {Partial<Props>} props
   * @returns {void}
   */
  $set(props) {
    if (this.$$set && !is_empty(props)) {
      this.$$.skip_bound = true;
      this.$$set(props);
      this.$$.skip_bound = false;
    }
  }
}
const PUBLIC_VERSION = "4";
if (typeof window !== "undefined")
  (window.__svelte || (window.__svelte = { v: /* @__PURE__ */ new Set() })).v.add(PUBLIC_VERSION);
const subscriber_queue = [];
function writable(value, start = noop) {
  let stop;
  const subscribers = /* @__PURE__ */ new Set();
  function set(new_value) {
    if (safe_not_equal(value, new_value)) {
      value = new_value;
      if (stop) {
        const run_queue = !subscriber_queue.length;
        for (const subscriber of subscribers) {
          subscriber[1]();
          subscriber_queue.push(subscriber, value);
        }
        if (run_queue) {
          for (let i = 0; i < subscriber_queue.length; i += 2) {
            subscriber_queue[i][0](subscriber_queue[i + 1]);
          }
          subscriber_queue.length = 0;
        }
      }
    }
  }
  function update2(fn) {
    set(fn(value));
  }
  function subscribe2(run2, invalidate = noop) {
    const subscriber = [run2, invalidate];
    subscribers.add(subscriber);
    if (subscribers.size === 1) {
      stop = start(set, update2) || noop;
    }
    run2(value);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0 && stop) {
        stop();
        stop = null;
      }
    };
  }
  return { set, update: update2, subscribe: subscribe2 };
}
function writableProperties(object, onChildModified) {
  const children2 = /* @__PURE__ */ new Map();
  const childNamespaces = /* @__PURE__ */ new Map();
  return {
    make(key, defaultValue) {
      let child = children2.get(String(key));
      if (child) {
        return child;
      }
      if (key in object) {
        child = writable(object[key]);
      } else {
        child = writable(defaultValue);
      }
      child.subscribe((newValue) => {
        if (object[key] !== newValue) {
          object[key] = newValue;
          onChildModified(key, newValue);
        }
      });
      children2.set(String(key), child);
      return child;
    },
    namespace(name) {
      let childNamespace = childNamespaces.get(String(name));
      if (childNamespace) {
        return childNamespace;
      }
      const childObj = object[name] || {};
      childNamespace = writableProperties(childObj, (key, newObj) => {
        childObj[key] = newObj;
        onChildModified(name, childObj);
      });
      childNamespaces.set(String(name), childNamespace);
      return childNamespace;
    }
  };
}
function cubicOut(t) {
  const f = t - 1;
  return f * f * f + 1;
}
function quintOut(t) {
  return --t * t * t * t * t + 1;
}
function create_fragment$n(ctx) {
  let svg;
  let svg_viewBox_value;
  let current;
  const default_slot_template = (
    /*#slots*/
    ctx[3].default
  );
  const default_slot = create_slot(
    default_slot_template,
    ctx,
    /*$$scope*/
    ctx[2],
    null
  );
  return {
    c() {
      svg = svg_element("svg");
      if (default_slot)
        default_slot.c();
      attr(svg, "xmlns", "http://www.w3.org/2000/svg");
      attr(
        svg,
        "width",
        /*width*/
        ctx[0]
      );
      attr(
        svg,
        "height",
        /*height*/
        ctx[1]
      );
      attr(svg, "viewBox", svg_viewBox_value = "0 0 " + /*width*/
      ctx[0] + " " + /*height*/
      ctx[1]);
      attr(svg, "fill", "none");
      attr(svg, "stroke", "currentColor");
      attr(svg, "stroke-width", "2");
      attr(svg, "stroke-linecap", "round");
      attr(svg, "stroke-linejoin", "round");
      attr(svg, "class", "svg-icon");
    },
    m(target, anchor) {
      insert(target, svg, anchor);
      if (default_slot) {
        default_slot.m(svg, null);
      }
      current = true;
    },
    p(ctx2, [dirty]) {
      if (default_slot) {
        if (default_slot.p && (!current || dirty & /*$$scope*/
        4)) {
          update_slot_base(
            default_slot,
            default_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[2],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[2]
            ) : get_slot_changes(
              default_slot_template,
              /*$$scope*/
              ctx2[2],
              dirty,
              null
            ),
            null
          );
        }
      }
      if (!current || dirty & /*width*/
      1) {
        attr(
          svg,
          "width",
          /*width*/
          ctx2[0]
        );
      }
      if (!current || dirty & /*height*/
      2) {
        attr(
          svg,
          "height",
          /*height*/
          ctx2[1]
        );
      }
      if (!current || dirty & /*width, height*/
      3 && svg_viewBox_value !== (svg_viewBox_value = "0 0 " + /*width*/
      ctx2[0] + " " + /*height*/
      ctx2[1])) {
        attr(svg, "viewBox", svg_viewBox_value);
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(default_slot, local);
      current = true;
    },
    o(local) {
      transition_out(default_slot, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(svg);
      }
      if (default_slot)
        default_slot.d(detaching);
    }
  };
}
function instance$k($$self, $$props, $$invalidate) {
  let { $$slots: slots = {}, $$scope } = $$props;
  let { width = 24 } = $$props;
  let { height = 24 } = $$props;
  $$self.$$set = ($$props2) => {
    if ("width" in $$props2)
      $$invalidate(0, width = $$props2.width);
    if ("height" in $$props2)
      $$invalidate(1, height = $$props2.height);
    if ("$$scope" in $$props2)
      $$invalidate(2, $$scope = $$props2.$$scope);
  };
  return [width, height, $$scope, slots];
}
class SvgIcon extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$k, create_fragment$n, safe_not_equal, { width: 0, height: 1 });
  }
}
function slide(node, { delay = 0, duration = 400, easing = cubicOut, axis = "y" } = {}) {
  const style = getComputedStyle(node);
  const opacity = +style.opacity;
  const primary_property = axis === "y" ? "height" : "width";
  const primary_property_value = parseFloat(style[primary_property]);
  const secondary_properties = axis === "y" ? ["top", "bottom"] : ["left", "right"];
  const capitalized_secondary_properties = secondary_properties.map(
    (e) => `${e[0].toUpperCase()}${e.slice(1)}`
  );
  const padding_start_value = parseFloat(style[`padding${capitalized_secondary_properties[0]}`]);
  const padding_end_value = parseFloat(style[`padding${capitalized_secondary_properties[1]}`]);
  const margin_start_value = parseFloat(style[`margin${capitalized_secondary_properties[0]}`]);
  const margin_end_value = parseFloat(style[`margin${capitalized_secondary_properties[1]}`]);
  const border_width_start_value = parseFloat(
    style[`border${capitalized_secondary_properties[0]}Width`]
  );
  const border_width_end_value = parseFloat(
    style[`border${capitalized_secondary_properties[1]}Width`]
  );
  return {
    delay,
    duration,
    easing,
    css: (t) => `overflow: hidden;opacity: ${Math.min(t * 20, 1) * opacity};${primary_property}: ${t * primary_property_value}px;padding-${secondary_properties[0]}: ${t * padding_start_value}px;padding-${secondary_properties[1]}: ${t * padding_end_value}px;margin-${secondary_properties[0]}: ${t * margin_start_value}px;margin-${secondary_properties[1]}: ${t * margin_end_value}px;border-${secondary_properties[0]}-width: ${t * border_width_start_value}px;border-${secondary_properties[1]}-width: ${t * border_width_end_value}px;`
  };
}
function create_fragment$m(ctx) {
  let button;
  let current;
  let mounted;
  let dispose;
  const default_slot_template = (
    /*#slots*/
    ctx[4].default
  );
  const default_slot = create_slot(
    default_slot_template,
    ctx,
    /*$$scope*/
    ctx[3],
    null
  );
  let button_levels = [
    /*$$restProps*/
    ctx[2]
  ];
  let button_data = {};
  for (let i = 0; i < button_levels.length; i += 1) {
    button_data = assign(button_data, button_levels[i]);
  }
  return {
    c() {
      button = element("button");
      if (default_slot)
        default_slot.c();
      set_attributes(button, button_data);
    },
    m(target, anchor) {
      insert(target, button, anchor);
      if (default_slot) {
        default_slot.m(button, null);
      }
      if (button.autofocus)
        button.focus();
      current = true;
      if (!mounted) {
        dispose = [
          listen(button, "click", prevent_default(
            /*handleClick*/
            ctx[0]
          )),
          listen(
            button,
            "keydown",
            /*handleKeydown*/
            ctx[1]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (default_slot) {
        if (default_slot.p && (!current || dirty & /*$$scope*/
        8)) {
          update_slot_base(
            default_slot,
            default_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[3],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[3]
            ) : get_slot_changes(
              default_slot_template,
              /*$$scope*/
              ctx2[3],
              dirty,
              null
            ),
            null
          );
        }
      }
      set_attributes(button, button_data = get_spread_update(button_levels, [dirty & /*$$restProps*/
      4 && /*$$restProps*/
      ctx2[2]]));
    },
    i(local) {
      if (current)
        return;
      transition_in(default_slot, local);
      current = true;
    },
    o(local) {
      transition_out(default_slot, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(button);
      }
      if (default_slot)
        default_slot.d(detaching);
      mounted = false;
      run_all(dispose);
    }
  };
}
function instance$j($$self, $$props, $$invalidate) {
  const omit_props_names = [];
  let $$restProps = compute_rest_props($$props, omit_props_names);
  let { $$slots: slots = {}, $$scope } = $$props;
  const dispatch2 = createEventDispatcher();
  function handleClick(event) {
    dispatch2("action", { inputEvent: event });
  }
  function handleKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      dispatch2("action", { inputEvent: event });
    }
  }
  $$self.$$set = ($$new_props) => {
    $$props = assign(assign({}, $$props), exclude_internal_props($$new_props));
    $$invalidate(2, $$restProps = compute_rest_props($$props, omit_props_names));
    if ("$$scope" in $$new_props)
      $$invalidate(3, $$scope = $$new_props.$$scope);
  };
  return [handleClick, handleKeydown, $$restProps, $$scope, slots];
}
class ActionButton extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$j, create_fragment$m, safe_not_equal, {});
  }
}
const CollapsableSection_svelte_svelte_type_style_lang = "";
function create_default_slot_1$4(ctx) {
  let path;
  return {
    c() {
      path = svg_element("path");
      attr(path, "d", "M3 8L12 17L21 8");
    },
    m(target, anchor) {
      insert(target, path, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(path);
      }
    }
  };
}
function create_default_slot$7(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_1$4] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      128) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_if_block$6(ctx) {
  let main;
  let main_transition;
  let current;
  const default_slot_template = (
    /*#slots*/
    ctx[6].default
  );
  const default_slot = create_slot(
    default_slot_template,
    ctx,
    /*$$scope*/
    ctx[7],
    null
  );
  return {
    c() {
      main = element("main");
      if (default_slot)
        default_slot.c();
    },
    m(target, anchor) {
      insert(target, main, anchor);
      if (default_slot) {
        default_slot.m(main, null);
      }
      current = true;
    },
    p(ctx2, dirty) {
      if (default_slot) {
        if (default_slot.p && (!current || dirty & /*$$scope*/
        128)) {
          update_slot_base(
            default_slot,
            default_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[7],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[7]
            ) : get_slot_changes(
              default_slot_template,
              /*$$scope*/
              ctx2[7],
              dirty,
              null
            ),
            null
          );
        }
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(default_slot, local);
      if (local) {
        add_render_callback(() => {
          if (!current)
            return;
          if (!main_transition)
            main_transition = create_bidirectional_transition(
              main,
              slide,
              {
                delay: 0,
                duration: 200,
                easing: quintOut,
                axis: "y"
              },
              true
            );
          main_transition.run(1);
        });
      }
      current = true;
    },
    o(local) {
      transition_out(default_slot, local);
      if (local) {
        if (!main_transition)
          main_transition = create_bidirectional_transition(
            main,
            slide,
            {
              delay: 0,
              duration: 200,
              easing: quintOut,
              axis: "y"
            },
            false
          );
        main_transition.run(0);
      }
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(main);
      }
      if (default_slot)
        default_slot.d(detaching);
      if (detaching && main_transition)
        main_transition.end();
    }
  };
}
function create_fragment$l(ctx) {
  let fieldset;
  let header;
  let actionbutton;
  let t0;
  let legend;
  let label;
  let t1;
  let t2;
  let fieldset_class_value;
  let current;
  let mounted;
  let dispose;
  actionbutton = new ActionButton({
    props: {
      tabindex: (
        /*tabindex*/
        ctx[3]
      ),
      id: (
        /*id*/
        ctx[5]
      ),
      $$slots: { default: [create_default_slot$7] },
      $$scope: { ctx }
    }
  });
  actionbutton.$on(
    "action",
    /*toggleCollapse*/
    ctx[4]
  );
  let if_block = !/*collapsed*/
  ctx[0] && create_if_block$6(ctx);
  return {
    c() {
      fieldset = element("fieldset");
      header = element("header");
      create_component(actionbutton.$$.fragment);
      t0 = space();
      legend = element("legend");
      label = element("label");
      t1 = text(
        /*name*/
        ctx[1]
      );
      t2 = space();
      if (if_block)
        if_block.c();
      attr(
        label,
        "for",
        /*id*/
        ctx[5]
      );
      attr(fieldset, "class", fieldset_class_value = "collapsable" + /*collapsed*/
      (ctx[0] ? " collapsed" : "") + " " + /*className*/
      ctx[2] + " svelte-1frl3wi");
    },
    m(target, anchor) {
      insert(target, fieldset, anchor);
      append(fieldset, header);
      mount_component(actionbutton, header, null);
      append(header, t0);
      append(header, legend);
      append(legend, label);
      append(label, t1);
      append(fieldset, t2);
      if (if_block)
        if_block.m(fieldset, null);
      current = true;
      if (!mounted) {
        dispose = listen(header, "mousedown", self(
          /*toggleCollapse*/
          ctx[4]
        ));
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      const actionbutton_changes = {};
      if (dirty & /*tabindex*/
      8)
        actionbutton_changes.tabindex = /*tabindex*/
        ctx2[3];
      if (dirty & /*$$scope*/
      128) {
        actionbutton_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton.$set(actionbutton_changes);
      if (!current || dirty & /*name*/
      2)
        set_data(
          t1,
          /*name*/
          ctx2[1]
        );
      if (!/*collapsed*/
      ctx2[0]) {
        if (if_block) {
          if_block.p(ctx2, dirty);
          if (dirty & /*collapsed*/
          1) {
            transition_in(if_block, 1);
          }
        } else {
          if_block = create_if_block$6(ctx2);
          if_block.c();
          transition_in(if_block, 1);
          if_block.m(fieldset, null);
        }
      } else if (if_block) {
        group_outros();
        transition_out(if_block, 1, 1, () => {
          if_block = null;
        });
        check_outros();
      }
      if (!current || dirty & /*collapsed, className*/
      5 && fieldset_class_value !== (fieldset_class_value = "collapsable" + /*collapsed*/
      (ctx2[0] ? " collapsed" : "") + " " + /*className*/
      ctx2[2] + " svelte-1frl3wi")) {
        attr(fieldset, "class", fieldset_class_value);
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(actionbutton.$$.fragment, local);
      transition_in(if_block);
      current = true;
    },
    o(local) {
      transition_out(actionbutton.$$.fragment, local);
      transition_out(if_block);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(fieldset);
      }
      destroy_component(actionbutton);
      if (if_block)
        if_block.d();
      mounted = false;
      dispose();
    }
  };
}
function instance$i($$self, $$props, $$invalidate) {
  let { $$slots: slots = {}, $$scope } = $$props;
  let { name } = $$props;
  let { class: className = "" } = $$props;
  let { tabindex = 0 } = $$props;
  let { collapsed = true } = $$props;
  function toggleCollapse() {
    $$invalidate(0, collapsed = !collapsed);
  }
  const id = "collapsable_section_" + Math.random().toString(36).slice(2);
  $$self.$$set = ($$props2) => {
    if ("name" in $$props2)
      $$invalidate(1, name = $$props2.name);
    if ("class" in $$props2)
      $$invalidate(2, className = $$props2.class);
    if ("tabindex" in $$props2)
      $$invalidate(3, tabindex = $$props2.tabindex);
    if ("collapsed" in $$props2)
      $$invalidate(0, collapsed = $$props2.collapsed);
    if ("$$scope" in $$props2)
      $$invalidate(7, $$scope = $$props2.$$scope);
  };
  return [collapsed, name, className, tabindex, toggleCollapse, id, slots, $$scope];
}
class CollapsableSection extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$i, create_fragment$l, safe_not_equal, {
      name: 1,
      class: 2,
      tabindex: 3,
      collapsed: 0
    });
  }
}
const ToggleInput_svelte_svelte_type_style_lang = "";
function create_fragment$k(ctx) {
  let div2;
  let label;
  let t0;
  let t1;
  let div1;
  let input;
  let t2;
  let div0;
  let div2_class_value;
  let mounted;
  let dispose;
  return {
    c() {
      div2 = element("div");
      label = element("label");
      t0 = text(
        /*name*/
        ctx[1]
      );
      t1 = space();
      div1 = element("div");
      input = element("input");
      t2 = space();
      div0 = element("div");
      attr(
        label,
        "for",
        /*id*/
        ctx[4]
      );
      attr(
        input,
        "id",
        /*id*/
        ctx[4]
      );
      attr(input, "type", "checkbox");
      attr(input, "class", "svelte-dk9drq");
      attr(div0, "class", "thumb svelte-dk9drq");
      attr(div1, "role", "checkbox");
      attr(
        div1,
        "tabindex",
        /*tabIndex*/
        ctx[2]
      );
      attr(
        div1,
        "aria-checked",
        /*checked*/
        ctx[0]
      );
      attr(div1, "class", "svelte-dk9drq");
      attr(div2, "class", div2_class_value = "toggle-input" + /*checked*/
      (ctx[0] ? " checked" : "") + " " + /*className*/
      ctx[3] + " svelte-dk9drq");
    },
    m(target, anchor) {
      insert(target, div2, anchor);
      append(div2, label);
      append(label, t0);
      append(div2, t1);
      append(div2, div1);
      append(div1, input);
      input.checked = /*checked*/
      ctx[0];
      append(div1, t2);
      append(div1, div0);
      if (!mounted) {
        dispose = [
          listen(
            input,
            "change",
            /*input_change_handler*/
            ctx[6]
          ),
          listen(
            div1,
            "click",
            /*toggle*/
            ctx[5]
          ),
          listen(
            div1,
            "keydown",
            /*keydown_handler*/
            ctx[7]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (dirty & /*name*/
      2)
        set_data(
          t0,
          /*name*/
          ctx2[1]
        );
      if (dirty & /*checked*/
      1) {
        input.checked = /*checked*/
        ctx2[0];
      }
      if (dirty & /*tabIndex*/
      4) {
        attr(
          div1,
          "tabindex",
          /*tabIndex*/
          ctx2[2]
        );
      }
      if (dirty & /*checked*/
      1) {
        attr(
          div1,
          "aria-checked",
          /*checked*/
          ctx2[0]
        );
      }
      if (dirty & /*checked, className*/
      9 && div2_class_value !== (div2_class_value = "toggle-input" + /*checked*/
      (ctx2[0] ? " checked" : "") + " " + /*className*/
      ctx2[3] + " svelte-dk9drq")) {
        attr(div2, "class", div2_class_value);
      }
    },
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(div2);
      }
      mounted = false;
      run_all(dispose);
    }
  };
}
function instance$h($$self, $$props, $$invalidate) {
  let { name } = $$props;
  let { tabIndex } = $$props;
  let { checked = false } = $$props;
  let { class: className = "" } = $$props;
  const id = "toggle_input_" + Math.random().toString(36).slice(2);
  function toggle() {
    $$invalidate(0, checked = !checked);
  }
  function input_change_handler() {
    checked = this.checked;
    $$invalidate(0, checked);
  }
  const keydown_handler = (e) => e.key === "Enter" ? toggle() : null;
  $$self.$$set = ($$props2) => {
    if ("name" in $$props2)
      $$invalidate(1, name = $$props2.name);
    if ("tabIndex" in $$props2)
      $$invalidate(2, tabIndex = $$props2.tabIndex);
    if ("checked" in $$props2)
      $$invalidate(0, checked = $$props2.checked);
    if ("class" in $$props2)
      $$invalidate(3, className = $$props2.class);
  };
  return [
    checked,
    name,
    tabIndex,
    className,
    id,
    toggle,
    input_change_handler,
    keydown_handler
  ];
}
class ToggleInput extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$h, create_fragment$k, safe_not_equal, {
      name: 1,
      tabIndex: 2,
      checked: 0,
      class: 3
    });
  }
}
function create_default_slot$6(ctx) {
  let toggleinput;
  let updating_checked;
  let current;
  function toggleinput_checked_binding(value) {
    ctx[5](value);
  }
  let toggleinput_props = {
    class: "control-item display-notes-input",
    name: "Names Below Points",
    tabIndex: 0
  };
  if (
    /*$displayNames*/
    ctx[1] !== void 0
  ) {
    toggleinput_props.checked = /*$displayNames*/
    ctx[1];
  }
  toggleinput = new ToggleInput({ props: toggleinput_props });
  binding_callbacks.push(() => bind(toggleinput, "checked", toggleinput_checked_binding));
  return {
    c() {
      create_component(toggleinput.$$.fragment);
    },
    m(target, anchor) {
      mount_component(toggleinput, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const toggleinput_changes = {};
      if (!updating_checked && dirty & /*$displayNames*/
      2) {
        updating_checked = true;
        toggleinput_changes.checked = /*$displayNames*/
        ctx2[1];
        add_flush_callback(() => updating_checked = false);
      }
      toggleinput.$set(toggleinput_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(toggleinput.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(toggleinput.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(toggleinput, detaching);
    }
  };
}
function create_fragment$j(ctx) {
  let collapsablesection;
  let updating_collapsed;
  let current;
  function collapsablesection_collapsed_binding(value) {
    ctx[6](value);
  }
  let collapsablesection_props = {
    class: "display-section",
    name: "Display",
    $$slots: { default: [create_default_slot$6] },
    $$scope: { ctx }
  };
  if (
    /*$collapsed*/
    ctx[0] !== void 0
  ) {
    collapsablesection_props.collapsed = /*$collapsed*/
    ctx[0];
  }
  collapsablesection = new CollapsableSection({ props: collapsablesection_props });
  binding_callbacks.push(() => bind(collapsablesection, "collapsed", collapsablesection_collapsed_binding));
  return {
    c() {
      create_component(collapsablesection.$$.fragment);
    },
    m(target, anchor) {
      mount_component(collapsablesection, target, anchor);
      current = true;
    },
    p(ctx2, [dirty]) {
      const collapsablesection_changes = {};
      if (dirty & /*$$scope, $displayNames*/
      130) {
        collapsablesection_changes.$$scope = { dirty, ctx: ctx2 };
      }
      if (!updating_collapsed && dirty & /*$collapsed*/
      1) {
        updating_collapsed = true;
        collapsablesection_changes.collapsed = /*$collapsed*/
        ctx2[0];
        add_flush_callback(() => updating_collapsed = false);
      }
      collapsablesection.$set(collapsablesection_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(collapsablesection.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(collapsablesection.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(collapsablesection, detaching);
    }
  };
}
function instance$g($$self, $$props, $$invalidate) {
  var _a, _b;
  let $collapsed;
  let $displayNames;
  let { namespacedWritable = void 0 } = $$props;
  let collapsed = (_a = namespacedWritable == null ? void 0 : namespacedWritable.make("collapsed", true)) != null ? _a : writable(true);
  component_subscribe($$self, collapsed, (value) => $$invalidate(0, $collapsed = value));
  let displayNames = (_b = namespacedWritable == null ? void 0 : namespacedWritable.make("names", false)) != null ? _b : writable(false);
  component_subscribe($$self, displayNames, (value) => $$invalidate(1, $displayNames = value));
  function toggleinput_checked_binding(value) {
    $displayNames = value;
    displayNames.set($displayNames);
  }
  function collapsablesection_collapsed_binding(value) {
    $collapsed = value;
    collapsed.set($collapsed);
  }
  $$self.$$set = ($$props2) => {
    if ("namespacedWritable" in $$props2)
      $$invalidate(4, namespacedWritable = $$props2.namespacedWritable);
  };
  return [
    $collapsed,
    $displayNames,
    collapsed,
    displayNames,
    namespacedWritable,
    toggleinput_checked_binding,
    collapsablesection_collapsed_binding
  ];
}
class TimelineDisplaySettings extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$g, create_fragment$j, safe_not_equal, { namespacedWritable: 4 });
  }
}
const TimelineSettings_svelte_svelte_type_style_lang = "";
const get_additional_settings_slot_changes$2 = (dirty) => ({});
const get_additional_settings_slot_context$2 = (ctx) => ({});
function create_else_block$1(ctx) {
  let actionbutton;
  let current;
  actionbutton = new ActionButton({
    props: {
      class: "open-button",
      "aria-label": "Open",
      $$slots: { default: [create_default_slot_3$1] },
      $$scope: { ctx }
    }
  });
  actionbutton.$on(
    "action",
    /*open*/
    ctx[5]
  );
  return {
    c() {
      create_component(actionbutton.$$.fragment);
    },
    m(target, anchor) {
      mount_component(actionbutton, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const actionbutton_changes = {};
      if (dirty & /*$$scope*/
      256) {
        actionbutton_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton.$set(actionbutton_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(actionbutton.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(actionbutton.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(actionbutton, detaching);
    }
  };
}
function create_if_block$5(ctx) {
  let actionbutton;
  let current;
  actionbutton = new ActionButton({
    props: {
      class: "close-button",
      "aria-label": "Close",
      $$slots: { default: [create_default_slot_1$3] },
      $$scope: { ctx }
    }
  });
  actionbutton.$on(
    "action",
    /*close*/
    ctx[4]
  );
  return {
    c() {
      create_component(actionbutton.$$.fragment);
    },
    m(target, anchor) {
      mount_component(actionbutton, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const actionbutton_changes = {};
      if (dirty & /*$$scope*/
      256) {
        actionbutton_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton.$set(actionbutton_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(actionbutton.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(actionbutton.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(actionbutton, detaching);
    }
  };
}
function create_default_slot_4$1(ctx) {
  let path;
  let t;
  let circle;
  return {
    c() {
      path = svg_element("path");
      t = space();
      circle = svg_element("circle");
      attr(path, "d", "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z");
      attr(circle, "cx", "12");
      attr(circle, "cy", "12");
      attr(circle, "r", "3");
    },
    m(target, anchor) {
      insert(target, path, anchor);
      insert(target, t, anchor);
      insert(target, circle, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(path);
        detach(t);
        detach(circle);
      }
    }
  };
}
function create_default_slot_3$1(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_4$1] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      256) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_default_slot_2$1(ctx) {
  let line0;
  let t;
  let line1;
  return {
    c() {
      line0 = svg_element("line");
      t = space();
      line1 = svg_element("line");
      attr(line0, "x1", "18");
      attr(line0, "y1", "6");
      attr(line0, "x2", "6");
      attr(line0, "y2", "18");
      attr(line1, "x1", "6");
      attr(line1, "y1", "6");
      attr(line1, "x2", "18");
      attr(line1, "y2", "18");
    },
    m(target, anchor) {
      insert(target, line0, anchor);
      insert(target, t, anchor);
      insert(target, line1, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(line0);
        detach(t);
        detach(line1);
      }
    }
  };
}
function create_default_slot_1$3(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_2$1] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      256) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_default_slot$5(ctx) {
  let span;
  return {
    c() {
      span = element("span");
      span.textContent = "Coming Soon!";
    },
    m(target, anchor) {
      insert(target, span, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(span);
      }
    }
  };
}
function create_fragment$i(ctx) {
  var _a;
  let form;
  let current_block_type_index;
  let if_block;
  let t0;
  let t1;
  let timelinedisplaysettings;
  let t2;
  let collapsablesection;
  let form_class_value;
  let current;
  let mounted;
  let dispose;
  const if_block_creators = [create_if_block$5, create_else_block$1];
  const if_blocks = [];
  function select_block_type(ctx2, dirty) {
    if (
      /*$isOpen*/
      ctx2[2]
    )
      return 0;
    return 1;
  }
  current_block_type_index = select_block_type(ctx);
  if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  const additional_settings_slot_template = (
    /*#slots*/
    ctx[6]["additional-settings"]
  );
  const additional_settings_slot = create_slot(
    additional_settings_slot_template,
    ctx,
    /*$$scope*/
    ctx[8],
    get_additional_settings_slot_context$2
  );
  timelinedisplaysettings = new TimelineDisplaySettings({
    props: {
      namespacedWritable: (
        /*namespacedWritable*/
        (_a = ctx[0]) == null ? void 0 : _a.namespace("display")
      )
    }
  });
  collapsablesection = new CollapsableSection({
    props: {
      name: "Layout",
      $$slots: { default: [create_default_slot$5] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      var _a2;
      form = element("form");
      if_block.c();
      t0 = space();
      if (additional_settings_slot)
        additional_settings_slot.c();
      t1 = space();
      create_component(timelinedisplaysettings.$$.fragment);
      t2 = space();
      create_component(collapsablesection.$$.fragment);
      attr(form, "class", form_class_value = "timeline-settings" + /*$isOpen*/
      (ctx[2] ? " open" : " closed") + " " + /*className*/
      ((_a2 = ctx[1]) != null ? _a2 : "") + " svelte-zwg04h");
    },
    m(target, anchor) {
      insert(target, form, anchor);
      if_blocks[current_block_type_index].m(form, null);
      append(form, t0);
      if (additional_settings_slot) {
        additional_settings_slot.m(form, null);
      }
      append(form, t1);
      mount_component(timelinedisplaysettings, form, null);
      append(form, t2);
      mount_component(collapsablesection, form, null);
      current = true;
      if (!mounted) {
        dispose = listen(form, "submit", stop_propagation(prevent_default(
          /*submit_handler*/
          ctx[7]
        )));
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      var _a2, _b;
      let previous_block_index = current_block_type_index;
      current_block_type_index = select_block_type(ctx2);
      if (current_block_type_index === previous_block_index) {
        if_blocks[current_block_type_index].p(ctx2, dirty);
      } else {
        group_outros();
        transition_out(if_blocks[previous_block_index], 1, 1, () => {
          if_blocks[previous_block_index] = null;
        });
        check_outros();
        if_block = if_blocks[current_block_type_index];
        if (!if_block) {
          if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx2);
          if_block.c();
        } else {
          if_block.p(ctx2, dirty);
        }
        transition_in(if_block, 1);
        if_block.m(form, t0);
      }
      if (additional_settings_slot) {
        if (additional_settings_slot.p && (!current || dirty & /*$$scope*/
        256)) {
          update_slot_base(
            additional_settings_slot,
            additional_settings_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[8],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[8]
            ) : get_slot_changes(
              additional_settings_slot_template,
              /*$$scope*/
              ctx2[8],
              dirty,
              get_additional_settings_slot_changes$2
            ),
            get_additional_settings_slot_context$2
          );
        }
      }
      const timelinedisplaysettings_changes = {};
      if (dirty & /*namespacedWritable*/
      1)
        timelinedisplaysettings_changes.namespacedWritable = /*namespacedWritable*/
        (_a2 = ctx2[0]) == null ? void 0 : _a2.namespace("display");
      timelinedisplaysettings.$set(timelinedisplaysettings_changes);
      const collapsablesection_changes = {};
      if (dirty & /*$$scope*/
      256) {
        collapsablesection_changes.$$scope = { dirty, ctx: ctx2 };
      }
      collapsablesection.$set(collapsablesection_changes);
      if (!current || dirty & /*$isOpen, className*/
      6 && form_class_value !== (form_class_value = "timeline-settings" + /*$isOpen*/
      (ctx2[2] ? " open" : " closed") + " " + /*className*/
      ((_b = ctx2[1]) != null ? _b : "") + " svelte-zwg04h")) {
        attr(form, "class", form_class_value);
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(if_block);
      transition_in(additional_settings_slot, local);
      transition_in(timelinedisplaysettings.$$.fragment, local);
      transition_in(collapsablesection.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(if_block);
      transition_out(additional_settings_slot, local);
      transition_out(timelinedisplaysettings.$$.fragment, local);
      transition_out(collapsablesection.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(form);
      }
      if_blocks[current_block_type_index].d();
      if (additional_settings_slot)
        additional_settings_slot.d(detaching);
      destroy_component(timelinedisplaysettings);
      destroy_component(collapsablesection);
      mounted = false;
      dispose();
    }
  };
}
function instance$f($$self, $$props, $$invalidate) {
  var _a;
  let $isOpen;
  let { $$slots: slots = {}, $$scope } = $$props;
  let { namespacedWritable = void 0 } = $$props;
  let { class: className = "" } = $$props;
  const isOpen = (_a = namespacedWritable == null ? void 0 : namespacedWritable.make("isOpen", false)) != null ? _a : writable(false);
  component_subscribe($$self, isOpen, (value) => $$invalidate(2, $isOpen = value));
  function close() {
    set_store_value(isOpen, $isOpen = false, $isOpen);
  }
  function open() {
    set_store_value(isOpen, $isOpen = true, $isOpen);
  }
  function submit_handler(event) {
    bubble.call(this, $$self, event);
  }
  $$self.$$set = ($$props2) => {
    if ("namespacedWritable" in $$props2)
      $$invalidate(0, namespacedWritable = $$props2.namespacedWritable);
    if ("class" in $$props2)
      $$invalidate(1, className = $$props2.class);
    if ("$$scope" in $$props2)
      $$invalidate(8, $$scope = $$props2.$$scope);
  };
  return [
    namespacedWritable,
    className,
    $isOpen,
    isOpen,
    close,
    open,
    slots,
    submit_handler,
    $$scope
  ];
}
class TimelineSettings extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$f, create_fragment$i, safe_not_equal, { namespacedWritable: 0, class: 1 });
  }
}
const TimelineNavigationControls_svelte_svelte_type_style_lang = "";
function create_default_slot_9(ctx) {
  let line0;
  let t;
  let line1;
  return {
    c() {
      line0 = svg_element("line");
      t = space();
      line1 = svg_element("line");
      attr(line0, "x1", "12");
      attr(line0, "y1", "5");
      attr(line0, "x2", "12");
      attr(line0, "y2", "19");
      attr(line1, "x1", "5");
      attr(line1, "y1", "12");
      attr(line1, "x2", "19");
      attr(line1, "y2", "12");
    },
    m(target, anchor) {
      insert(target, line0, anchor);
      insert(target, t, anchor);
      insert(target, line1, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(line0);
        detach(t);
        detach(line1);
      }
    }
  };
}
function create_default_slot_8(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_9] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      128) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_default_slot_7(ctx) {
  let line;
  return {
    c() {
      line = svg_element("line");
      attr(line, "x1", "5");
      attr(line, "y1", "12");
      attr(line, "x2", "19");
      attr(line, "y2", "12");
    },
    m(target, anchor) {
      insert(target, line, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(line);
      }
    }
  };
}
function create_default_slot_6(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_7] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      128) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_default_slot_5(ctx) {
  let path0;
  let t0;
  let path1;
  let t1;
  let path2;
  let t2;
  let path3;
  return {
    c() {
      path0 = svg_element("path");
      t0 = space();
      path1 = svg_element("path");
      t1 = space();
      path2 = svg_element("path");
      t2 = space();
      path3 = svg_element("path");
      attr(path0, "d", "M8 3H5a2 2 0 0 0-2 2v3");
      attr(path1, "d", "M21 8V5a2 2 0 0 0-2-2h-3");
      attr(path2, "d", "M3 16v3a2 2 0 0 0 2 2h3");
      attr(path3, "d", "M16 21h3a2 2 0 0 0 2-2v-3");
    },
    m(target, anchor) {
      insert(target, path0, anchor);
      insert(target, t0, anchor);
      insert(target, path1, anchor);
      insert(target, t1, anchor);
      insert(target, path2, anchor);
      insert(target, t2, anchor);
      insert(target, path3, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(path0);
        detach(t0);
        detach(path1);
        detach(t1);
        detach(path2);
        detach(t2);
        detach(path3);
      }
    }
  };
}
function create_default_slot_4(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_5] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      128) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_default_slot_3(ctx) {
  let path0;
  let t0;
  let path1;
  let t1;
  let path2;
  return {
    c() {
      path0 = svg_element("path");
      t0 = space();
      path1 = svg_element("path");
      t1 = space();
      path2 = svg_element("path");
      attr(path0, "d", "M3 19V5");
      attr(path1, "d", "m13 6-6 6 6 6");
      attr(path2, "d", "M7 12h14");
    },
    m(target, anchor) {
      insert(target, path0, anchor);
      insert(target, t0, anchor);
      insert(target, path1, anchor);
      insert(target, t1, anchor);
      insert(target, path2, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(path0);
        detach(t0);
        detach(path1);
        detach(t1);
        detach(path2);
      }
    }
  };
}
function create_default_slot_2(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_3] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      128) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_default_slot_1$2(ctx) {
  let path0;
  let t;
  let path1;
  return {
    c() {
      path0 = svg_element("path");
      t = space();
      path1 = svg_element("path");
      attr(path0, "d", "m12 19-7-7 7-7");
      attr(path1, "d", "M19 12H5");
    },
    m(target, anchor) {
      insert(target, path0, anchor);
      insert(target, t, anchor);
      insert(target, path1, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(path0);
        detach(t);
        detach(path1);
      }
    }
  };
}
function create_default_slot$4(ctx) {
  let svgicon;
  let current;
  svgicon = new SvgIcon({
    props: {
      $$slots: { default: [create_default_slot_1$2] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(svgicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(svgicon, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const svgicon_changes = {};
      if (dirty & /*$$scope*/
      128) {
        svgicon_changes.$$scope = { dirty, ctx: ctx2 };
      }
      svgicon.$set(svgicon_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(svgicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(svgicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(svgicon, detaching);
    }
  };
}
function create_fragment$h(ctx) {
  let menu;
  let li0;
  let actionbutton0;
  let t0;
  let li1;
  let actionbutton1;
  let t1;
  let li2;
  let actionbutton2;
  let t2;
  let li3;
  let actionbutton3;
  let t3;
  let li4;
  let actionbutton4;
  let menu_class_value;
  let current;
  actionbutton0 = new ActionButton({
    props: {
      "aria-label": "Zoom In",
      $$slots: { default: [create_default_slot_8] },
      $$scope: { ctx }
    }
  });
  actionbutton0.$on(
    "action",
    /*triggerZoomIn*/
    ctx[1]
  );
  actionbutton1 = new ActionButton({
    props: {
      "aria-label": "Zoom Out",
      $$slots: { default: [create_default_slot_6] },
      $$scope: { ctx }
    }
  });
  actionbutton1.$on(
    "action",
    /*triggerZoomOut*/
    ctx[2]
  );
  actionbutton2 = new ActionButton({
    props: {
      "aria-label": "Zoom to Fit",
      $$slots: { default: [create_default_slot_4] },
      $$scope: { ctx }
    }
  });
  actionbutton2.$on(
    "action",
    /*triggerZoomToFit*/
    ctx[3]
  );
  actionbutton3 = new ActionButton({
    props: {
      "aria-label": "Scroll to Zero",
      $$slots: { default: [create_default_slot_2] },
      $$scope: { ctx }
    }
  });
  actionbutton3.$on(
    "action",
    /*triggerScrollToZero*/
    ctx[4]
  );
  actionbutton4 = new ActionButton({
    props: {
      "aria-label": "Scroll to First",
      $$slots: { default: [create_default_slot$4] },
      $$scope: { ctx }
    }
  });
  actionbutton4.$on(
    "action",
    /*triggerScrollToFirst*/
    ctx[5]
  );
  return {
    c() {
      var _a;
      menu = element("menu");
      li0 = element("li");
      create_component(actionbutton0.$$.fragment);
      t0 = space();
      li1 = element("li");
      create_component(actionbutton1.$$.fragment);
      t1 = space();
      li2 = element("li");
      create_component(actionbutton2.$$.fragment);
      t2 = space();
      li3 = element("li");
      create_component(actionbutton3.$$.fragment);
      t3 = space();
      li4 = element("li");
      create_component(actionbutton4.$$.fragment);
      attr(li0, "class", "control-item svelte-rpvlcd");
      attr(li1, "class", "control-item svelte-rpvlcd");
      attr(li2, "class", "control-item svelte-rpvlcd");
      attr(li3, "class", "control-item svelte-rpvlcd");
      attr(li4, "class", "control-item svelte-rpvlcd");
      attr(menu, "class", menu_class_value = "timeline-navigation-controls " + /*className*/
      ((_a = ctx[0]) != null ? _a : ""));
    },
    m(target, anchor) {
      insert(target, menu, anchor);
      append(menu, li0);
      mount_component(actionbutton0, li0, null);
      append(menu, t0);
      append(menu, li1);
      mount_component(actionbutton1, li1, null);
      append(menu, t1);
      append(menu, li2);
      mount_component(actionbutton2, li2, null);
      append(menu, t2);
      append(menu, li3);
      mount_component(actionbutton3, li3, null);
      append(menu, t3);
      append(menu, li4);
      mount_component(actionbutton4, li4, null);
      current = true;
    },
    p(ctx2, [dirty]) {
      var _a;
      const actionbutton0_changes = {};
      if (dirty & /*$$scope*/
      128) {
        actionbutton0_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton0.$set(actionbutton0_changes);
      const actionbutton1_changes = {};
      if (dirty & /*$$scope*/
      128) {
        actionbutton1_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton1.$set(actionbutton1_changes);
      const actionbutton2_changes = {};
      if (dirty & /*$$scope*/
      128) {
        actionbutton2_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton2.$set(actionbutton2_changes);
      const actionbutton3_changes = {};
      if (dirty & /*$$scope*/
      128) {
        actionbutton3_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton3.$set(actionbutton3_changes);
      const actionbutton4_changes = {};
      if (dirty & /*$$scope*/
      128) {
        actionbutton4_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton4.$set(actionbutton4_changes);
      if (!current || dirty & /*className*/
      1 && menu_class_value !== (menu_class_value = "timeline-navigation-controls " + /*className*/
      ((_a = ctx2[0]) != null ? _a : ""))) {
        attr(menu, "class", menu_class_value);
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(actionbutton0.$$.fragment, local);
      transition_in(actionbutton1.$$.fragment, local);
      transition_in(actionbutton2.$$.fragment, local);
      transition_in(actionbutton3.$$.fragment, local);
      transition_in(actionbutton4.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(actionbutton0.$$.fragment, local);
      transition_out(actionbutton1.$$.fragment, local);
      transition_out(actionbutton2.$$.fragment, local);
      transition_out(actionbutton3.$$.fragment, local);
      transition_out(actionbutton4.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(menu);
      }
      destroy_component(actionbutton0);
      destroy_component(actionbutton1);
      destroy_component(actionbutton2);
      destroy_component(actionbutton3);
      destroy_component(actionbutton4);
    }
  };
}
function instance$e($$self, $$props, $$invalidate) {
  let { navigation } = $$props;
  let { class: className = "" } = $$props;
  function triggerZoomIn() {
    navigation.zoomIn();
  }
  function triggerZoomOut() {
    navigation.zoomOut();
  }
  function triggerZoomToFit() {
    navigation.zoomToFit();
  }
  function triggerScrollToZero() {
    navigation.scrollToValue(0);
  }
  function triggerScrollToFirst() {
    navigation.scrollToFirst();
  }
  $$self.$$set = ($$props2) => {
    if ("navigation" in $$props2)
      $$invalidate(6, navigation = $$props2.navigation);
    if ("class" in $$props2)
      $$invalidate(0, className = $$props2.class);
  };
  return [
    className,
    triggerZoomIn,
    triggerZoomOut,
    triggerZoomToFit,
    triggerScrollToZero,
    triggerScrollToFirst,
    navigation
  ];
}
class TimelineNavigationControls extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$e, create_fragment$h, safe_not_equal, { navigation: 6, class: 0 });
  }
}
const TimelineControls_svelte_svelte_type_style_lang = "";
const get_additional_settings_slot_changes$1 = (dirty) => ({});
const get_additional_settings_slot_context$1 = (ctx) => ({});
function create_additional_settings_slot$2(ctx) {
  let current;
  const additional_settings_slot_template = (
    /*#slots*/
    ctx[2]["additional-settings"]
  );
  const additional_settings_slot = create_slot(
    additional_settings_slot_template,
    ctx,
    /*$$scope*/
    ctx[3],
    get_additional_settings_slot_context$1
  );
  return {
    c() {
      if (additional_settings_slot)
        additional_settings_slot.c();
    },
    m(target, anchor) {
      if (additional_settings_slot) {
        additional_settings_slot.m(target, anchor);
      }
      current = true;
    },
    p(ctx2, dirty) {
      if (additional_settings_slot) {
        if (additional_settings_slot.p && (!current || dirty & /*$$scope*/
        8)) {
          update_slot_base(
            additional_settings_slot,
            additional_settings_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[3],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[3]
            ) : get_slot_changes(
              additional_settings_slot_template,
              /*$$scope*/
              ctx2[3],
              dirty,
              get_additional_settings_slot_changes$1
            ),
            get_additional_settings_slot_context$1
          );
        }
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(additional_settings_slot, local);
      current = true;
    },
    o(local) {
      transition_out(additional_settings_slot, local);
      current = false;
    },
    d(detaching) {
      if (additional_settings_slot)
        additional_settings_slot.d(detaching);
    }
  };
}
function create_fragment$g(ctx) {
  let menu;
  let timelinenavigationcontrols;
  let t;
  let timelinesettings;
  let current;
  timelinenavigationcontrols = new TimelineNavigationControls({
    props: {
      class: "control-group",
      navigation: (
        /*navigation*/
        ctx[1]
      )
    }
  });
  timelinesettings = new TimelineSettings({
    props: {
      class: "control-group",
      namespacedWritable: (
        /*namespacedWritable*/
        ctx[0]
      ),
      $$slots: {
        "additional-settings": [create_additional_settings_slot$2]
      },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      menu = element("menu");
      create_component(timelinenavigationcontrols.$$.fragment);
      t = space();
      create_component(timelinesettings.$$.fragment);
      attr(menu, "class", "timeline-controls svelte-od4311");
    },
    m(target, anchor) {
      insert(target, menu, anchor);
      mount_component(timelinenavigationcontrols, menu, null);
      append(menu, t);
      mount_component(timelinesettings, menu, null);
      current = true;
    },
    p(ctx2, [dirty]) {
      const timelinenavigationcontrols_changes = {};
      if (dirty & /*navigation*/
      2)
        timelinenavigationcontrols_changes.navigation = /*navigation*/
        ctx2[1];
      timelinenavigationcontrols.$set(timelinenavigationcontrols_changes);
      const timelinesettings_changes = {};
      if (dirty & /*namespacedWritable*/
      1)
        timelinesettings_changes.namespacedWritable = /*namespacedWritable*/
        ctx2[0];
      if (dirty & /*$$scope*/
      8) {
        timelinesettings_changes.$$scope = { dirty, ctx: ctx2 };
      }
      timelinesettings.$set(timelinesettings_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(timelinenavigationcontrols.$$.fragment, local);
      transition_in(timelinesettings.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(timelinenavigationcontrols.$$.fragment, local);
      transition_out(timelinesettings.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(menu);
      }
      destroy_component(timelinenavigationcontrols);
      destroy_component(timelinesettings);
    }
  };
}
function instance$d($$self, $$props, $$invalidate) {
  let { $$slots: slots = {}, $$scope } = $$props;
  let { namespacedWritable = void 0 } = $$props;
  let { navigation } = $$props;
  $$self.$$set = ($$props2) => {
    if ("namespacedWritable" in $$props2)
      $$invalidate(0, namespacedWritable = $$props2.namespacedWritable);
    if ("navigation" in $$props2)
      $$invalidate(1, navigation = $$props2.navigation);
    if ("$$scope" in $$props2)
      $$invalidate(3, $$scope = $$props2.$$scope);
  };
  return [namespacedWritable, navigation, slots, $$scope];
}
class TimelineControls extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$d, create_fragment$g, safe_not_equal, { namespacedWritable: 0, navigation: 1 });
  }
}
class TimelineNavigationSvelteImpl {
  constructor(valuePerPixelProperty, items, setFocalValue, availableWidth) {
    __publicField(this, "valuePerPixel");
    this.valuePerPixelProperty = valuePerPixelProperty;
    this.items = items;
    this.setFocalValue = setFocalValue;
    this.availableWidth = availableWidth;
    this.valuePerPixel = 1;
    valuePerPixelProperty.subscribe((newValue) => {
      this.valuePerPixel = newValue;
    });
  }
  zoomIn(constraints) {
    let orderOfMagnitude = Math.floor(Math.log10(this.valuePerPixel));
    const scaleBase = Math.pow(10, orderOfMagnitude);
    let multiple = Math.floor(this.valuePerPixel / scaleBase);
    multiple -= 1;
    if (multiple === 0) {
      multiple = 9;
      orderOfMagnitude -= 1;
    }
    const newScale = this.valuePerPixelProperty.set(
      multiple * Math.pow(10, orderOfMagnitude)
    );
    if (constraints != null) {
      const { keepValue, at } = constraints;
      this.setFocalValue(() => keepValue - at * newScale);
    }
  }
  zoomOut(constraints) {
    let orderOfMagnitude = Math.floor(Math.log10(this.valuePerPixel));
    const scaleBase = Math.pow(10, orderOfMagnitude);
    let multiple = Math.floor(this.valuePerPixel / scaleBase);
    multiple += 1;
    if (multiple === 10) {
      multiple = 1;
      orderOfMagnitude += 1;
    }
    const newScale = this.valuePerPixelProperty.set(
      multiple * Math.pow(10, orderOfMagnitude)
    );
    if (constraints != null) {
      const { keepValue, at } = constraints;
      this.setFocalValue(() => keepValue - at * newScale);
    }
  }
  zoomToFit(items = this.items.get(), width = this.availableWidth()) {
    const minimum = this.minimumValue(items);
    const maximum = this.maximumValue(items);
    const span = maximum - minimum;
    if (span === 0) {
      this.valuePerPixelProperty.set(1);
      this.setFocalValue(() => minimum);
      return;
    }
    this.valuePerPixelProperty.set(span / width);
    const centerValue = this.centerValue();
    this.setFocalValue(() => centerValue);
  }
  scrollToFirst() {
    const minimum = this.minimumValue();
    this.scrollToValue(minimum);
  }
  scrollToValue(value) {
    this.setFocalValue(() => value);
  }
  minimumValue(items = this.items.get()) {
    let minimumValue;
    for (const item of items) {
      if (minimumValue === void 0 || item.value() < minimumValue) {
        minimumValue = item.value();
      }
    }
    if (minimumValue === void 0) {
      minimumValue = 0;
    }
    return minimumValue;
  }
  maximumValue(items = this.items.get()) {
    let maximumValue;
    for (const item of items) {
      if (maximumValue === void 0 || item.value() > maximumValue) {
        maximumValue = item.value();
      }
    }
    if (maximumValue === void 0) {
      maximumValue = 0;
    }
    return maximumValue;
  }
  centerValue(items = this.items.get()) {
    const minimumValue = this.minimumValue(items);
    const maximumValue = this.maximumValue(items);
    return (maximumValue - minimumValue) / 2 + minimumValue;
  }
}
function timelineNavigation(valuePerPixel, items, focalValue, availableWidth) {
  return new TimelineNavigationSvelteImpl(valuePerPixel, items, focalValue, availableWidth);
}
function displayDateValue(value, scale) {
  const date = new Date(value);
  const dateString = date.toLocaleDateString();
  if (scale < 24 * 60 * 60 * 1e3) {
    if (scale < 1e3) {
      return dateString + " " + date.toLocaleTimeString() + " " + date.getMilliseconds() + "ms";
    }
    return dateString + " " + date.toLocaleTimeString();
  }
  return dateString;
}
class DateValueDisplay {
  constructor() {
    __publicField(this, "labelStepValue");
    this.labelStepValue = 1001;
  }
  displayValue(value) {
    return displayDateValue(value, this.labelStepValue);
  }
  getSmallestLabelStepValue(valuePerPixel) {
    const factors = {
      1e3: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3],
      12: [1, 2, 3, 4, 6, 12],
      24: [1, 2, 3, 4, 6, 12, 24],
      60: [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60],
      365: [1, 2, 73, 365]
    };
    const units = {
      "millisecond": 1e3,
      "second": 60,
      "minute": 60,
      "hour": 24,
      "day": 365,
      "year": 1e3
    };
    const unitMultiples = {
      "millisecond": 1,
      "second": 1e3,
      "minute": 60 * 1e3,
      "hour": 60 * 60 * 1e3,
      "day": 24 * 60 * 60 * 1e3,
      "year": 365 * 24 * 60 * 60 * 1e3
    };
    const minStepWidths = {
      "millisecond": 256,
      "second": 160,
      "minute": 160,
      "hour": 160,
      "day": 128,
      "year": 128
    };
    outer:
      for (const [unit, maximum] of Object.entries(units)) {
        const unitFactors = factors[maximum];
        const unitMultiple = unitMultiples[unit];
        const minStepWidth = minStepWidths[unit];
        const minStepValue = minStepWidth * valuePerPixel;
        for (const factor of unitFactors) {
          const total = unitMultiple * factor;
          if (total >= minStepValue) {
            this.labelStepValue = total;
            break outer;
          }
        }
      }
    this.labelStepValue = getSmallestMultipleOf10Above(128 * valuePerPixel);
    return this.labelStepValue;
  }
  labels(labelCount, labelStepValue, firstLabelValue) {
    if (labelCount < 1 || Number.isNaN(labelCount)) {
      labelCount = 1;
    }
    const values = new Array(Math.ceil(labelCount)).fill(0).map((_, i) => firstLabelValue + i * labelStepValue);
    return values.map((value) => ({ text: this.displayValue(value), value }));
  }
}
function timelineDateValueDisplay() {
  return new DateValueDisplay();
}
const numericValueDisplay = {
  labels(labelCount, labelStepValue, firstLabelValue) {
    if (labelCount < 1 || Number.isNaN(labelCount)) {
      labelCount = 1;
    }
    const values = new Array(Math.ceil(labelCount)).fill(0).map((_, i) => firstLabelValue + i * labelStepValue);
    return values.map((value) => ({ text: this.displayValue(value), value }));
  },
  getSmallestLabelStepValue(valuePerPixel) {
    const minStepWidth = 64;
    const minStepValue = minStepWidth * valuePerPixel;
    return getSmallestMultipleOf10Above(minStepValue);
  },
  displayValue(value) {
    return value.toLocaleString();
  }
};
function getSmallestMultipleOf10Above(minStepValue) {
  const log = Math.floor(Math.log10(minStepValue));
  const orderOfMagnitude = Math.pow(10, log);
  const options = [1, 2.5, 5, 10].map((it) => it * orderOfMagnitude);
  return options.find(
    (it) => Math.floor(it) === it && it > minStepValue
  );
}
function timelineNumericValueDisplay() {
  return numericValueDisplay;
}
const RulerLabel_svelte_svelte_type_style_lang = "";
function create_fragment$f(ctx) {
  let div;
  let t;
  let div_class_value;
  return {
    c() {
      div = element("div");
      t = text(
        /*text*/
        ctx[0]
      );
      attr(div, "class", div_class_value = "label " + /*className*/
      ctx[2] + " svelte-s3m838");
      attr(
        div,
        "data-value",
        /*text*/
        ctx[0]
      );
      set_style(
        div,
        "left",
        /*position*/
        ctx[1] + "px"
      );
    },
    m(target, anchor) {
      insert(target, div, anchor);
      append(div, t);
    },
    p(ctx2, [dirty]) {
      if (dirty & /*text*/
      1)
        set_data(
          t,
          /*text*/
          ctx2[0]
        );
      if (dirty & /*className*/
      4 && div_class_value !== (div_class_value = "label " + /*className*/
      ctx2[2] + " svelte-s3m838")) {
        attr(div, "class", div_class_value);
      }
      if (dirty & /*text*/
      1) {
        attr(
          div,
          "data-value",
          /*text*/
          ctx2[0]
        );
      }
      if (dirty & /*position*/
      2) {
        set_style(
          div,
          "left",
          /*position*/
          ctx2[1] + "px"
        );
      }
    },
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(div);
      }
    }
  };
}
function instance$c($$self, $$props, $$invalidate) {
  let { text: text2 } = $$props;
  let { position } = $$props;
  let { class: className = "" } = $$props;
  $$self.$$set = ($$props2) => {
    if ("text" in $$props2)
      $$invalidate(0, text2 = $$props2.text);
    if ("position" in $$props2)
      $$invalidate(1, position = $$props2.position);
    if ("class" in $$props2)
      $$invalidate(2, className = $$props2.class);
  };
  return [text2, position, className];
}
class RulerLabel extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$c, create_fragment$f, safe_not_equal, { text: 0, position: 1, class: 2 });
  }
}
const TimelineRuler_svelte_svelte_type_style_lang = "";
function get_each_context$2(ctx, list, i) {
  const child_ctx = ctx.slice();
  child_ctx[17] = list[i];
  return child_ctx;
}
function create_each_block$2(key_1, ctx) {
  let first;
  let rulerlabel;
  let current;
  rulerlabel = new RulerLabel({
    props: {
      text: (
        /*label*/
        ctx[17].text
      ),
      position: (
        /*label*/
        (ctx[17].value - /*focalValue*/
        ctx[1]) / /*valuePerPixel*/
        ctx[0] + /*width*/
        ctx[2] / 2
      )
    }
  });
  return {
    key: key_1,
    first: null,
    c() {
      first = empty();
      create_component(rulerlabel.$$.fragment);
      this.first = first;
    },
    m(target, anchor) {
      insert(target, first, anchor);
      mount_component(rulerlabel, target, anchor);
      current = true;
    },
    p(new_ctx, dirty) {
      ctx = new_ctx;
      const rulerlabel_changes = {};
      if (dirty & /*labels*/
      64)
        rulerlabel_changes.text = /*label*/
        ctx[17].text;
      if (dirty & /*labels, focalValue, valuePerPixel, width*/
      71)
        rulerlabel_changes.position = /*label*/
        (ctx[17].value - /*focalValue*/
        ctx[1]) / /*valuePerPixel*/
        ctx[0] + /*width*/
        ctx[2] / 2;
      rulerlabel.$set(rulerlabel_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(rulerlabel.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(rulerlabel.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(first);
      }
      destroy_component(rulerlabel, detaching);
    }
  };
}
function create_if_block$4(ctx) {
  let div;
  let t_value = (
    /*mousePosition*/
    ctx[4].value + ""
  );
  let t;
  let div_resize_listener;
  return {
    c() {
      div = element("div");
      t = text(t_value);
      attr(div, "class", "mouse-position-tooltip svelte-15ugul4");
      set_style(div, "right", Math.min(
        /*width*/
        ctx[2] - /*mousePosition*/
        ctx[4].x,
        /*width*/
        ctx[2] - /*mousePositionTooltipWidth*/
        ctx[5]
      ) + "px");
      add_render_callback(() => (
        /*div_elementresize_handler_1*/
        ctx[14].call(div)
      ));
    },
    m(target, anchor) {
      insert(target, div, anchor);
      append(div, t);
      div_resize_listener = add_iframe_resize_listener(
        div,
        /*div_elementresize_handler_1*/
        ctx[14].bind(div)
      );
    },
    p(ctx2, dirty) {
      if (dirty & /*mousePosition*/
      16 && t_value !== (t_value = /*mousePosition*/
      ctx2[4].value + ""))
        set_data(t, t_value);
      if (dirty & /*width, mousePosition, mousePositionTooltipWidth*/
      52) {
        set_style(div, "right", Math.min(
          /*width*/
          ctx2[2] - /*mousePosition*/
          ctx2[4].x,
          /*width*/
          ctx2[2] - /*mousePositionTooltipWidth*/
          ctx2[5]
        ) + "px");
      }
    },
    d(detaching) {
      if (detaching) {
        detach(div);
      }
      div_resize_listener();
    }
  };
}
function create_fragment$e(ctx) {
  let div;
  let rulerlabel;
  let t0;
  let each_blocks = [];
  let each_1_lookup = /* @__PURE__ */ new Map();
  let div_resize_listener;
  let t1;
  let if_block_anchor;
  let current;
  let mounted;
  let dispose;
  rulerlabel = new RulerLabel({
    props: {
      class: "measurement",
      text: "1234567890-:/APM",
      position: 0
    }
  });
  let each_value = ensure_array_like(
    /*labels*/
    ctx[6]
  );
  const get_key = (ctx2) => (
    /*label*/
    ctx2[17].value
  );
  for (let i = 0; i < each_value.length; i += 1) {
    let child_ctx = get_each_context$2(ctx, each_value, i);
    let key = get_key(child_ctx);
    each_1_lookup.set(key, each_blocks[i] = create_each_block$2(key, child_ctx));
  }
  let if_block = (
    /*mousePosition*/
    ctx[4] != null && create_if_block$4(ctx)
  );
  return {
    c() {
      div = element("div");
      create_component(rulerlabel.$$.fragment);
      t0 = space();
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].c();
      }
      t1 = space();
      if (if_block)
        if_block.c();
      if_block_anchor = empty();
      attr(div, "class", "ruler svelte-15ugul4");
      set_style(
        div,
        "--label-width",
        /*labelStepWidth*/
        ctx[3] + "px"
      );
      attr(div, "role", "slider");
      attr(div, "aria-valuemin", Number.NEGATIVE_INFINITY);
      attr(div, "aria-valuemax", Number.POSITIVE_INFINITY);
      attr(
        div,
        "aria-valuenow",
        /*focalValue*/
        ctx[1]
      );
      attr(div, "tabindex", "0");
      add_render_callback(() => (
        /*div_elementresize_handler*/
        ctx[13].call(div)
      ));
    },
    m(target, anchor) {
      insert(target, div, anchor);
      mount_component(rulerlabel, div, null);
      append(div, t0);
      for (let i = 0; i < each_blocks.length; i += 1) {
        if (each_blocks[i]) {
          each_blocks[i].m(div, null);
        }
      }
      div_resize_listener = add_iframe_resize_listener(
        div,
        /*div_elementresize_handler*/
        ctx[13].bind(div)
      );
      insert(target, t1, anchor);
      if (if_block)
        if_block.m(target, anchor);
      insert(target, if_block_anchor, anchor);
      current = true;
      if (!mounted) {
        dispose = [
          listen(
            div,
            "mousemove",
            /*onMeasureMouseLocation*/
            ctx[7],
            true
          ),
          listen(
            div,
            "mouseleave",
            /*stopMeasureMouseLocation*/
            ctx[8]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (dirty & /*labels, focalValue, valuePerPixel, width*/
      71) {
        each_value = ensure_array_like(
          /*labels*/
          ctx2[6]
        );
        group_outros();
        each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx2, each_value, each_1_lookup, div, outro_and_destroy_block, create_each_block$2, null, get_each_context$2);
        check_outros();
      }
      if (!current || dirty & /*labelStepWidth*/
      8) {
        set_style(
          div,
          "--label-width",
          /*labelStepWidth*/
          ctx2[3] + "px"
        );
      }
      if (!current || dirty & /*focalValue*/
      2) {
        attr(
          div,
          "aria-valuenow",
          /*focalValue*/
          ctx2[1]
        );
      }
      if (
        /*mousePosition*/
        ctx2[4] != null
      ) {
        if (if_block) {
          if_block.p(ctx2, dirty);
        } else {
          if_block = create_if_block$4(ctx2);
          if_block.c();
          if_block.m(if_block_anchor.parentNode, if_block_anchor);
        }
      } else if (if_block) {
        if_block.d(1);
        if_block = null;
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(rulerlabel.$$.fragment, local);
      for (let i = 0; i < each_value.length; i += 1) {
        transition_in(each_blocks[i]);
      }
      current = true;
    },
    o(local) {
      transition_out(rulerlabel.$$.fragment, local);
      for (let i = 0; i < each_blocks.length; i += 1) {
        transition_out(each_blocks[i]);
      }
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(div);
        detach(t1);
        detach(if_block_anchor);
      }
      destroy_component(rulerlabel);
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].d();
      }
      div_resize_listener();
      if (if_block)
        if_block.d(detaching);
      mounted = false;
      run_all(dispose);
    }
  };
}
function getLabelCount(stepWidth, fullWidth) {
  return Math.ceil(fullWidth / stepWidth) + 1;
}
function instance$b($$self, $$props, $$invalidate) {
  let labelStepValue;
  let labelStepWidth;
  let labelCount;
  let firstLabelValue;
  let labels;
  let { display } = $$props;
  let { valuePerPixel } = $$props;
  let { focalValue } = $$props;
  let width = 0;
  const dispatch2 = createEventDispatcher();
  function getFirstLabelValue(focalValue2, valuePerPixel2, labelStepValue2) {
    const valueOnLeftSide = focalValue2 - width / 2 * valuePerPixel2;
    return Math.floor(valueOnLeftSide / labelStepValue2) * labelStepValue2;
  }
  let mousePosition;
  function onMeasureMouseLocation(event) {
    const maybeRuler = event.currentTarget;
    if (maybeRuler == null || !("getBoundingClientRect" in maybeRuler)) {
      return;
    }
    let currentTargetRect = maybeRuler.getBoundingClientRect();
    const x = event.pageX - currentTargetRect.left;
    const distanceToCenter = width / 2 - x;
    let value = Math.floor(focalValue - distanceToCenter * valuePerPixel);
    if (Object.is(value, -0)) {
      value = 0;
    }
    $$invalidate(4, mousePosition = { value: display.displayValue(value), x });
    dispatch2("mouseMeasurement", mousePosition);
  }
  function stopMeasureMouseLocation(event) {
    $$invalidate(4, mousePosition = void 0);
    dispatch2("mouseMeasurement", mousePosition);
  }
  let mousePositionTooltipWidth;
  function div_elementresize_handler() {
    width = this.clientWidth;
    $$invalidate(2, width);
  }
  function div_elementresize_handler_1() {
    mousePositionTooltipWidth = this.clientWidth;
    $$invalidate(5, mousePositionTooltipWidth);
  }
  $$self.$$set = ($$props2) => {
    if ("display" in $$props2)
      $$invalidate(9, display = $$props2.display);
    if ("valuePerPixel" in $$props2)
      $$invalidate(0, valuePerPixel = $$props2.valuePerPixel);
    if ("focalValue" in $$props2)
      $$invalidate(1, focalValue = $$props2.focalValue);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty & /*display, valuePerPixel*/
    513) {
      $$invalidate(11, labelStepValue = display.getSmallestLabelStepValue(valuePerPixel));
    }
    if ($$self.$$.dirty & /*labelStepValue, valuePerPixel*/
    2049) {
      $$invalidate(3, labelStepWidth = labelStepValue / valuePerPixel);
    }
    if ($$self.$$.dirty & /*labelStepWidth, width*/
    12) {
      $$invalidate(12, labelCount = getLabelCount(labelStepWidth, width));
    }
    if ($$self.$$.dirty & /*focalValue, valuePerPixel, labelStepValue*/
    2051) {
      $$invalidate(10, firstLabelValue = getFirstLabelValue(focalValue, valuePerPixel, labelStepValue));
    }
    if ($$self.$$.dirty & /*display, labelCount, labelStepValue, firstLabelValue*/
    7680) {
      $$invalidate(6, labels = display.labels(labelCount, labelStepValue, firstLabelValue));
    }
  };
  return [
    valuePerPixel,
    focalValue,
    width,
    labelStepWidth,
    mousePosition,
    mousePositionTooltipWidth,
    labels,
    onMeasureMouseLocation,
    stopMeasureMouseLocation,
    display,
    firstLabelValue,
    labelStepValue,
    labelCount,
    div_elementresize_handler,
    div_elementresize_handler_1
  ];
}
class TimelineRuler extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$b, create_fragment$e, safe_not_equal, {
      display: 9,
      valuePerPixel: 0,
      focalValue: 1
    });
  }
}
function* renderStage(viewport, point, scale, sortedItems) {
  var _a;
  const pointRadius = point.width / 2;
  const PI2 = 2 * Math.PI;
  const renderHeight = viewport.height + point.width;
  const defaultColor = this.fillStyle;
  this.beginPath();
  this.clearRect(0, 0, viewport.width, viewport.height);
  const pointBounds = Array.from(layoutPoints(viewport, point, scale, sortedItems));
  let maxY = 0;
  for (const bounds of pointBounds) {
    if (bounds.bottom > maxY)
      maxY = bounds.bottom;
  }
  const maxScroll = Math.max(0, maxY + point.marginY - viewport.height);
  if (viewport.scrollTop > maxScroll)
    viewport.scrollTop = maxScroll;
  let currentColor = this.fillStyle;
  for (const bounds of pointBounds) {
    const scrolledY = bounds.centerY - viewport.scrollTop;
    if (scrolledY < -point.width || scrolledY > renderHeight)
      continue;
    const color = (_a = bounds.item.color()) != null ? _a : defaultColor;
    if (color !== currentColor) {
      this.closePath();
      this.fill();
      this.beginPath();
    }
    this.fillStyle = color;
    this.moveTo(bounds.right, scrolledY);
    this.arc(bounds.centerX, scrolledY, pointRadius, 0, PI2);
    yield new PointBounds(bounds.centerX, scrolledY, bounds.item, point);
  }
  this.closePath();
  this.fill();
}
function* layoutPoints(viewport, point, scale, sortedItems) {
  const renderWidth = viewport.width + point.width;
  const visibleRange = [
    viewport.centerValue - scale.toValue(renderWidth / 2),
    viewport.centerValue + scale.toValue(renderWidth / 2)
  ];
  const leftOffset = Math.floor(viewport.width / 2) - scale.toPixels(viewport.centerValue);
  const pointRadius = Math.floor(point.width / 2);
  const lastXByRow = [];
  let prev;
  for (const item of sortedItems) {
    if (item.value() > visibleRange[1])
      continue;
    const absolutePixelCenter = scale.toPixels(item.value());
    const relativePixelCenter = absolutePixelCenter + leftOffset;
    const relativeLeftMargin = relativePixelCenter - pointRadius - point.marginX;
    let row;
    if (relativeLeftMargin === (prev == null ? void 0 : prev.relativeLeftMargin)) {
      row = findNextAvailableRow(relativeLeftMargin, lastXByRow, prev.row);
    } else {
      row = findNextAvailableRow(relativeLeftMargin, lastXByRow);
    }
    const bounds = new PointBounds(
      relativePixelCenter,
      row * (point.width + point.marginY) + pointRadius + point.marginY,
      item,
      point
    );
    lastXByRow[row] = bounds.right;
    prev = { relativeLeftMargin, row, value: item.value() };
    yield bounds;
  }
}
function findNextAvailableRow(relativeLeftMargin, lastXByRow, startIndex = 0) {
  for (let rowIndex = startIndex; rowIndex < lastXByRow.length; rowIndex++) {
    const x = lastXByRow[rowIndex];
    if (x < relativeLeftMargin) {
      return rowIndex;
    }
  }
  return lastXByRow.length;
}
class PointBounds {
  constructor(centerX, centerY, item, point) {
    this.centerX = centerX;
    this.centerY = centerY;
    this.item = item;
    this.point = point;
  }
  get x() {
    return this.centerX - this.point.width / 2;
  }
  get y() {
    return this.centerY - this.point.width / 2;
  }
  get left() {
    return this.x;
  }
  get right() {
    return this.centerX + this.point.width / 2;
  }
  get top() {
    return this.y;
  }
  get bottom() {
    return this.centerY + this.point.width / 2;
  }
  contains(x, y) {
    return this.x <= x && x < this.right && this.y <= y && y < this.bottom;
  }
}
const CanvasStage_svelte_svelte_type_style_lang = "";
function create_if_block$3(ctx) {
  let div1;
  let div0;
  let t0_value = (
    /*hover*/
    ctx[5].bounds.item.name() + ""
  );
  let t0;
  let t1;
  let t2_value = (
    /*display*/
    ctx[0].displayValue(
      /*hover*/
      ctx[5].bounds.item.value()
    ) + ""
  );
  let t2;
  return {
    c() {
      div1 = element("div");
      div0 = element("div");
      t0 = text(t0_value);
      t1 = text(": ");
      t2 = text(t2_value);
      attr(div0, "class", "display-name");
      attr(div1, "class", "timeline-point hover svelte-zlrf5b");
      set_style(
        div1,
        "top",
        /*hover*/
        ctx[5].bounds.y + /*canvasTop*/
        ctx[4] + "px"
      );
      set_style(
        div1,
        "left",
        /*hover*/
        ctx[5].bounds.x + "px"
      );
    },
    m(target, anchor) {
      insert(target, div1, anchor);
      append(div1, div0);
      append(div0, t0);
      append(div0, t1);
      append(div0, t2);
    },
    p(ctx2, dirty) {
      if (dirty & /*hover*/
      32 && t0_value !== (t0_value = /*hover*/
      ctx2[5].bounds.item.name() + ""))
        set_data(t0, t0_value);
      if (dirty & /*display, hover*/
      33 && t2_value !== (t2_value = /*display*/
      ctx2[0].displayValue(
        /*hover*/
        ctx2[5].bounds.item.value()
      ) + ""))
        set_data(t2, t2_value);
      if (dirty & /*hover, canvasTop*/
      48) {
        set_style(
          div1,
          "top",
          /*hover*/
          ctx2[5].bounds.y + /*canvasTop*/
          ctx2[4] + "px"
        );
      }
      if (dirty & /*hover*/
      32) {
        set_style(
          div1,
          "left",
          /*hover*/
          ctx2[5].bounds.x + "px"
        );
      }
    },
    d(detaching) {
      if (detaching) {
        detach(div1);
      }
    }
  };
}
function create_fragment$d(ctx) {
  let canvas_1;
  let canvas_1_style_value;
  let t0;
  let t1;
  let div3;
  let div0;
  let t2;
  let div1;
  let t3;
  let div2;
  let mounted;
  let dispose;
  let if_block = (
    /*hover*/
    ctx[5] != null && create_if_block$3(ctx)
  );
  return {
    c() {
      canvas_1 = element("canvas");
      t0 = space();
      if (if_block)
        if_block.c();
      t1 = space();
      div3 = element("div");
      div0 = element("div");
      t2 = space();
      div1 = element("div");
      t3 = space();
      div2 = element("div");
      attr(canvas_1, "style", canvas_1_style_value = `top: ${/*canvasTop*/
      ctx[4]}px;`);
      attr(canvas_1, "class", "svelte-zlrf5b");
      toggle_class(
        canvas_1,
        "has-hover",
        /*hover*/
        ctx[5] != null
      );
      attr(div0, "class", "timeline-point svelte-zlrf5b");
      set_style(div0, "float", "left");
      attr(div1, "class", "timeline-point svelte-zlrf5b");
      set_style(div1, "clear", "right");
      attr(div2, "class", "timeline-point svelte-zlrf5b");
      attr(div3, "class", "stage svelte-zlrf5b");
    },
    m(target, anchor) {
      insert(target, canvas_1, anchor);
      ctx[15](canvas_1);
      insert(target, t0, anchor);
      if (if_block)
        if_block.m(target, anchor);
      insert(target, t1, anchor);
      insert(target, div3, anchor);
      append(div3, div0);
      ctx[16](div0);
      append(div3, t2);
      append(div3, div1);
      ctx[17](div1);
      append(div3, t3);
      append(div3, div2);
      ctx[18](div2);
      ctx[19](div3);
      if (!mounted) {
        dispose = [
          listen(canvas_1, "wheel", stop_propagation(
            /*handleScroll*/
            ctx[6]
          ), true),
          listen(
            canvas_1,
            "mousemove",
            /*detectHover*/
            ctx[8]
          ),
          listen(
            canvas_1,
            "click",
            /*handleClick*/
            ctx[7]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (dirty & /*canvasTop*/
      16 && canvas_1_style_value !== (canvas_1_style_value = `top: ${/*canvasTop*/
      ctx2[4]}px;`)) {
        attr(canvas_1, "style", canvas_1_style_value);
      }
      if (dirty & /*hover*/
      32) {
        toggle_class(
          canvas_1,
          "has-hover",
          /*hover*/
          ctx2[5] != null
        );
      }
      if (
        /*hover*/
        ctx2[5] != null
      ) {
        if (if_block) {
          if_block.p(ctx2, dirty);
        } else {
          if_block = create_if_block$3(ctx2);
          if_block.c();
          if_block.m(t1.parentNode, t1);
        }
      } else if (if_block) {
        if_block.d(1);
        if_block = null;
      }
    },
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(canvas_1);
        detach(t0);
        detach(t1);
        detach(div3);
      }
      ctx[15](null);
      if (if_block)
        if_block.d(detaching);
      ctx[16](null);
      ctx[17](null);
      ctx[18](null);
      ctx[19](null);
      mounted = false;
      run_all(dispose);
    }
  };
}
function instance$a($$self, $$props, $$invalidate) {
  const dispatch2 = createEventDispatcher();
  let { display } = $$props;
  let { sortedItems } = $$props;
  let { scale } = $$props;
  let { focalValue } = $$props;
  let { width = 0 } = $$props;
  let canvas;
  const pointElements = [void 0, void 0, void 0];
  let stageCSSTarget;
  let canvasTop = 0;
  const viewport = {
    width: 0,
    height: 0,
    centerValue: 0,
    padding: 0,
    scrollTop: 0
  };
  let pointStyle;
  const pointDimentions = { width: 0, marginX: 0, marginY: 0 };
  let changesNeeded = true;
  const resizeObserver = new ResizeObserver(() => {
    if (canvas == null || pointElements.some((el) => el == null) || stageCSSTarget == null) {
      return;
    }
    if (canvasTop != stageCSSTarget.offsetTop) {
      $$invalidate(4, canvasTop = stageCSSTarget.offsetTop);
    }
    changesNeeded = changesNeeded || viewport.width != stageCSSTarget.clientWidth || viewport.height != stageCSSTarget.clientHeight || viewport.padding != stageCSSTarget.clientWidth - stageCSSTarget.innerWidth || pointDimentions.width != pointElements[0].clientWidth;
    $$invalidate(14, viewport.width = stageCSSTarget.clientWidth, viewport);
    $$invalidate(14, viewport.height = stageCSSTarget.clientHeight, viewport);
    $$invalidate(14, viewport.padding = stageCSSTarget.clientWidth - stageCSSTarget.innerWidth + pointElements[0].clientWidth, viewport);
    pointDimentions.width = pointElements[0].clientWidth;
    pointDimentions.marginX = Math.max(0, pointElements[1].offsetLeft - (pointElements[0].offsetLeft + pointElements[0].clientWidth));
    pointDimentions.marginY = Math.max(0, pointElements[2].offsetTop - (pointElements[0].offsetTop + pointElements[0].clientHeight));
    const reportedWidth = viewport.width - viewport.padding;
    if (width != reportedWidth) {
      $$invalidate(9, width = reportedWidth);
    }
  });
  function handleScroll(event) {
    if (event.shiftKey) {
      dispatch2(`scrollX`, scale.toValue(event.deltaY));
    } else if (event.ctrlKey) {
      const xRelativeToMiddle = event.offsetX - viewport.width / 2;
      const zoomFocusValue = focalValue + scale.toValue(xRelativeToMiddle);
      if (event.deltaY > 0) {
        dispatch2(`zoomOut`, {
          keepValue: zoomFocusValue,
          at: xRelativeToMiddle,
          within: viewport.width
        });
      } else if (event.deltaY < 0) {
        dispatch2(`zoomIn`, {
          keepValue: zoomFocusValue,
          at: xRelativeToMiddle,
          within: viewport.width
        });
      }
    } else {
      const newScroll = Math.max(0, viewport.scrollTop + event.deltaY);
      if (viewport.scrollTop != newScroll) {
        $$invalidate(14, viewport.scrollTop = newScroll, viewport);
        changesNeeded = true;
      }
    }
  }
  function handleClick(event) {
    if (hover == null)
      return;
    dispatch2("select", { item: hover.bounds.item, causedBy: event });
  }
  let pointBounds = [];
  let hover = null;
  function detectHover(event) {
    for (const bounds of pointBounds) {
      if (bounds.contains(event.offsetX, event.offsetY)) {
        $$invalidate(5, hover = {
          bounds,
          pos: [event.offsetX, event.offsetY]
        });
        return;
      }
    }
    $$invalidate(5, hover = null);
  }
  function onPointsOrScaleChanged(points, scale2) {
    changesNeeded = true;
  }
  function invalidateColors() {
    changesNeeded = true;
  }
  onMount(() => {
    if (canvas == null || pointElements.some((el) => el == null) || stageCSSTarget == null) {
      return;
    }
    resizeObserver.observe(canvas);
    resizeObserver.observe(pointElements[0]);
    resizeObserver.observe(stageCSSTarget);
    pointStyle = getComputedStyle(pointElements[0]);
    function draw() {
      if (canvas == null)
        return;
      if (canvas.width != viewport.width)
        $$invalidate(1, canvas.width = viewport.width, canvas);
      if (canvas.height != viewport.height)
        $$invalidate(1, canvas.height = viewport.height, canvas);
      const renderContext = canvas.getContext("2d");
      if (renderContext == null)
        return;
      if (changesNeeded) {
        renderContext.fillStyle = pointStyle.backgroundColor;
        pointBounds = [];
        let maxY = 0;
        for (const pointBound of renderStage.call(renderContext, viewport, pointDimentions, scale, sortedItems)) {
          pointBounds.push(pointBound);
          if (pointBound.bottom > maxY)
            maxY = pointBound.bottom;
        }
        if (hover != null)
          detectHover({
            offsetX: hover.pos[0],
            offsetY: hover.pos[1]
          });
        changesNeeded = false;
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  });
  function canvas_1_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      canvas = $$value;
      $$invalidate(1, canvas);
    });
  }
  function div0_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      pointElements[0] = $$value;
      $$invalidate(2, pointElements);
    });
  }
  function div1_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      pointElements[1] = $$value;
      $$invalidate(2, pointElements);
    });
  }
  function div2_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      pointElements[2] = $$value;
      $$invalidate(2, pointElements);
    });
  }
  function div3_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      stageCSSTarget = $$value;
      $$invalidate(3, stageCSSTarget);
    });
  }
  $$self.$$set = ($$props2) => {
    if ("display" in $$props2)
      $$invalidate(0, display = $$props2.display);
    if ("sortedItems" in $$props2)
      $$invalidate(10, sortedItems = $$props2.sortedItems);
    if ("scale" in $$props2)
      $$invalidate(11, scale = $$props2.scale);
    if ("focalValue" in $$props2)
      $$invalidate(12, focalValue = $$props2.focalValue);
    if ("width" in $$props2)
      $$invalidate(9, width = $$props2.width);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty & /*viewport, focalValue*/
    20480) {
      if (viewport.centerValue != focalValue) {
        changesNeeded = true;
        $$invalidate(14, viewport.centerValue = focalValue, viewport);
      }
    }
    if ($$self.$$.dirty & /*sortedItems, scale*/
    3072) {
      onPointsOrScaleChanged();
    }
  };
  return [
    display,
    canvas,
    pointElements,
    stageCSSTarget,
    canvasTop,
    hover,
    handleScroll,
    handleClick,
    detectHover,
    width,
    sortedItems,
    scale,
    focalValue,
    invalidateColors,
    viewport,
    canvas_1_binding,
    div0_binding,
    div1_binding,
    div2_binding,
    div3_binding
  ];
}
class CanvasStage extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$a, create_fragment$d, safe_not_equal, {
      display: 0,
      sortedItems: 10,
      scale: 11,
      focalValue: 12,
      width: 9,
      invalidateColors: 13
    });
  }
  get invalidateColors() {
    return this.$$.ctx[13];
  }
}
const Timeline_svelte_svelte_type_style_lang = "";
const get_additional_settings_slot_changes = (dirty) => ({});
const get_additional_settings_slot_context = (ctx) => ({});
function create_additional_settings_slot$1(ctx) {
  let current;
  const additional_settings_slot_template = (
    /*#slots*/
    ctx[17]["additional-settings"]
  );
  const additional_settings_slot = create_slot(
    additional_settings_slot_template,
    ctx,
    /*$$scope*/
    ctx[25],
    get_additional_settings_slot_context
  );
  return {
    c() {
      if (additional_settings_slot)
        additional_settings_slot.c();
    },
    m(target, anchor) {
      if (additional_settings_slot) {
        additional_settings_slot.m(target, anchor);
      }
      current = true;
    },
    p(ctx2, dirty) {
      if (additional_settings_slot) {
        if (additional_settings_slot.p && (!current || dirty & /*$$scope*/
        33554432)) {
          update_slot_base(
            additional_settings_slot,
            additional_settings_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[25],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[25]
            ) : get_slot_changes(
              additional_settings_slot_template,
              /*$$scope*/
              ctx2[25],
              dirty,
              get_additional_settings_slot_changes
            ),
            get_additional_settings_slot_context
          );
        }
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(additional_settings_slot, local);
      current = true;
    },
    o(local) {
      transition_out(additional_settings_slot, local);
      current = false;
    },
    d(detaching) {
      if (additional_settings_slot)
        additional_settings_slot.d(detaching);
    }
  };
}
function create_fragment$c(ctx) {
  var _a;
  let div;
  let timelineruler;
  let t0;
  let canvasstage;
  let updating_width;
  let t1;
  let timelinecontrols;
  let current;
  timelineruler = new TimelineRuler({
    props: {
      display: (
        /*display*/
        ctx[3]
      ),
      valuePerPixel: (
        /*$valuePerPixel*/
        ctx[5]
      ),
      focalValue: (
        /*$focalValue*/
        ctx[4]
      )
    }
  });
  function canvasstage_width_binding(value) {
    ctx[20](value);
  }
  let canvasstage_props = {
    display: (
      /*display*/
      ctx[3]
    ),
    sortedItems: (
      /*sortedItems*/
      ctx[2]
    ),
    scale: {
      toPixels: (
        /*func*/
        ctx[18]
      ),
      toValue: (
        /*func_1*/
        ctx[19]
      )
    },
    focalValue: (
      /*$focalValue*/
      ctx[4]
    )
  };
  if (
    /*$stageWidth*/
    ctx[1] !== void 0
  ) {
    canvasstage_props.width = /*$stageWidth*/
    ctx[1];
  }
  canvasstage = new CanvasStage({ props: canvasstage_props });
  binding_callbacks.push(() => bind(canvasstage, "width", canvasstage_width_binding));
  canvasstage.$on(
    "scrollX",
    /*scrollX_handler*/
    ctx[21]
  );
  canvasstage.$on(
    "zoomIn",
    /*zoomIn_handler*/
    ctx[22]
  );
  canvasstage.$on(
    "zoomOut",
    /*zoomOut_handler*/
    ctx[23]
  );
  canvasstage.$on(
    "select",
    /*select_handler*/
    ctx[24]
  );
  timelinecontrols = new TimelineControls({
    props: {
      namespacedWritable: (
        /*namespacedWritable*/
        (_a = ctx[0]) == null ? void 0 : _a.namespace("settings")
      ),
      navigation: (
        /*navigation*/
        ctx[10]
      ),
      $$slots: {
        "additional-settings": [create_additional_settings_slot$1]
      },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      div = element("div");
      create_component(timelineruler.$$.fragment);
      t0 = space();
      create_component(canvasstage.$$.fragment);
      t1 = space();
      create_component(timelinecontrols.$$.fragment);
      attr(div, "class", "timeline svelte-zh2vtz");
    },
    m(target, anchor) {
      insert(target, div, anchor);
      mount_component(timelineruler, div, null);
      append(div, t0);
      mount_component(canvasstage, div, null);
      append(div, t1);
      mount_component(timelinecontrols, div, null);
      current = true;
    },
    p(ctx2, [dirty]) {
      var _a2;
      const timelineruler_changes = {};
      if (dirty & /*display*/
      8)
        timelineruler_changes.display = /*display*/
        ctx2[3];
      if (dirty & /*$valuePerPixel*/
      32)
        timelineruler_changes.valuePerPixel = /*$valuePerPixel*/
        ctx2[5];
      if (dirty & /*$focalValue*/
      16)
        timelineruler_changes.focalValue = /*$focalValue*/
        ctx2[4];
      timelineruler.$set(timelineruler_changes);
      const canvasstage_changes = {};
      if (dirty & /*display*/
      8)
        canvasstage_changes.display = /*display*/
        ctx2[3];
      if (dirty & /*sortedItems*/
      4)
        canvasstage_changes.sortedItems = /*sortedItems*/
        ctx2[2];
      if (dirty & /*$valuePerPixel*/
      32)
        canvasstage_changes.scale = {
          toPixels: (
            /*func*/
            ctx2[18]
          ),
          toValue: (
            /*func_1*/
            ctx2[19]
          )
        };
      if (dirty & /*$focalValue*/
      16)
        canvasstage_changes.focalValue = /*$focalValue*/
        ctx2[4];
      if (!updating_width && dirty & /*$stageWidth*/
      2) {
        updating_width = true;
        canvasstage_changes.width = /*$stageWidth*/
        ctx2[1];
        add_flush_callback(() => updating_width = false);
      }
      canvasstage.$set(canvasstage_changes);
      const timelinecontrols_changes = {};
      if (dirty & /*namespacedWritable*/
      1)
        timelinecontrols_changes.namespacedWritable = /*namespacedWritable*/
        (_a2 = ctx2[0]) == null ? void 0 : _a2.namespace("settings");
      if (dirty & /*$$scope*/
      33554432) {
        timelinecontrols_changes.$$scope = { dirty, ctx: ctx2 };
      }
      timelinecontrols.$set(timelinecontrols_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(timelineruler.$$.fragment, local);
      transition_in(canvasstage.$$.fragment, local);
      transition_in(timelinecontrols.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(timelineruler.$$.fragment, local);
      transition_out(canvasstage.$$.fragment, local);
      transition_out(timelinecontrols.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(div);
      }
      destroy_component(timelineruler);
      destroy_component(canvasstage);
      destroy_component(timelinecontrols);
    }
  };
}
function instance$9($$self, $$props, $$invalidate) {
  var _a, _b;
  let display;
  let $stageWidth;
  let $focalValue;
  let $scale;
  let $valuePerPixel;
  let { $$slots: slots = {}, $$scope } = $$props;
  let { namespacedWritable = void 0 } = $$props;
  let { displayPropertyAs } = $$props;
  const focalValue = (_a = namespacedWritable == null ? void 0 : namespacedWritable.make("focalValue", 0)) != null ? _a : writable(0);
  component_subscribe($$self, focalValue, (value) => $$invalidate(4, $focalValue = value));
  const scale = (_b = namespacedWritable == null ? void 0 : namespacedWritable.make("scale", 1)) != null ? _b : writable(1);
  component_subscribe($$self, scale, (value) => $$invalidate(16, $scale = value));
  let { items: unsortedItems = [] } = $$props;
  let sortedItems = [];
  function valuePerPixelStore(initialValue = 1) {
    function atLeastMinimum(value) {
      const minimum = 1 / 64;
      if (Number.isNaN(value)) {
        return minimum;
      }
      return Math.max(minimum, value);
    }
    const { subscribe: subscribe2, set } = writable(atLeastMinimum(initialValue));
    return {
      subscribe: subscribe2,
      set: (newValue) => {
        const validated = atLeastMinimum(newValue);
        set(validated);
        set_store_value(scale, $scale = validated, $scale);
        return validated;
      }
    };
  }
  const valuePerPixel = valuePerPixelStore($scale);
  component_subscribe($$self, valuePerPixel, (value) => $$invalidate(5, $valuePerPixel = value));
  const stageWidth = writable(0);
  component_subscribe($$self, stageWidth, (value) => $$invalidate(1, $stageWidth = value));
  const navigation = timelineNavigation(
    valuePerPixel,
    {
      get() {
        return sortedItems;
      }
    },
    (updater) => {
      const newFocalValue = updater($focalValue);
      if (newFocalValue != $focalValue) {
        set_store_value(focalValue, $focalValue = newFocalValue, $focalValue);
      }
    },
    () => $stageWidth
  );
  function zoomToFit(items) {
    if (initialized) {
      navigation.zoomToFit(items, $stageWidth);
    } else {
      const unsubscribe = stageWidth.subscribe((newStageWidth) => {
        if (newStageWidth > 0) {
          navigation.zoomToFit(items, newStageWidth);
          unsubscribe();
        }
      });
    }
  }
  function refresh() {
    $$invalidate(2, sortedItems), $$invalidate(12, unsortedItems);
  }
  let initialized = false;
  const func = function(value) {
    return Math.floor(value / $valuePerPixel);
  };
  const func_1 = function(pixels) {
    return $valuePerPixel * pixels;
  };
  function canvasstage_width_binding(value) {
    $stageWidth = value;
    stageWidth.set($stageWidth);
  }
  const scrollX_handler = ({ detail }) => navigation.scrollToValue($focalValue + detail);
  const zoomIn_handler = ({ detail }) => navigation.zoomIn(detail);
  const zoomOut_handler = ({ detail }) => navigation.zoomOut(detail);
  function select_handler(event) {
    bubble.call(this, $$self, event);
  }
  $$self.$$set = ($$props2) => {
    if ("namespacedWritable" in $$props2)
      $$invalidate(0, namespacedWritable = $$props2.namespacedWritable);
    if ("displayPropertyAs" in $$props2)
      $$invalidate(11, displayPropertyAs = $$props2.displayPropertyAs);
    if ("items" in $$props2)
      $$invalidate(12, unsortedItems = $$props2.items);
    if ("$$scope" in $$props2)
      $$invalidate(25, $$scope = $$props2.$$scope);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty & /*unsortedItems*/
    4096) {
      $$invalidate(2, sortedItems = unsortedItems.toSorted((a, b) => a.value() - b.value()));
    }
    if ($$self.$$.dirty & /*$scale*/
    65536) {
      set_store_value(valuePerPixel, $valuePerPixel = $scale, $valuePerPixel);
    }
    if ($$self.$$.dirty & /*initialized, $stageWidth*/
    32770) {
      if (!initialized) {
        if ($stageWidth > 0) {
          $$invalidate(15, initialized = true);
        }
      }
    }
    if ($$self.$$.dirty & /*displayPropertyAs*/
    2048) {
      $$invalidate(3, display = displayPropertyAs === "date" ? timelineDateValueDisplay() : timelineNumericValueDisplay());
    }
  };
  return [
    namespacedWritable,
    $stageWidth,
    sortedItems,
    display,
    $focalValue,
    $valuePerPixel,
    focalValue,
    scale,
    valuePerPixel,
    stageWidth,
    navigation,
    displayPropertyAs,
    unsortedItems,
    zoomToFit,
    refresh,
    initialized,
    $scale,
    slots,
    func,
    func_1,
    canvasstage_width_binding,
    scrollX_handler,
    zoomIn_handler,
    zoomOut_handler,
    select_handler,
    $$scope
  ];
}
class Timeline extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$9, create_fragment$c, safe_not_equal, {
      namespacedWritable: 0,
      displayPropertyAs: 11,
      items: 12,
      zoomToFit: 13,
      refresh: 14
    });
  }
  get zoomToFit() {
    return this.$$.ctx[13];
  }
  get refresh() {
    return this.$$.ctx[14];
  }
}
class TimelineFileItem {
  constructor(obsidianFile, propertySelection) {
    __publicField(this, "_group");
    this.obsidianFile = obsidianFile;
    this.propertySelection = propertySelection;
  }
  id() {
    return this.obsidianFile.path();
  }
  value() {
    return this.propertySelection.selectProperty(this.obsidianFile);
  }
  name() {
    return this.obsidianFile.nameWithoutExtension();
  }
  applyGroup(group2) {
    this._group = group2;
  }
  color() {
    var _a;
    return (_a = this._group) == null ? void 0 : _a.color;
  }
  group() {
    var _a;
    return (_a = this._group) == null ? void 0 : _a.id;
  }
  forgetGroup() {
    this._group = void 0;
  }
}
function getPropertySelector(prop, availableProperties) {
  if (prop === void 0) {
    return NoPropertySelector;
  }
  if (prop.toLocaleLowerCase() === "created") {
    return FileCreationSelector;
  }
  if (prop.toLocaleLowerCase() === "modified") {
    return FileModificationSelector;
  }
  const type = availableProperties.typeOf(prop);
  if (type === "date" || type === "datetime") {
    return new DatePropertySelector(prop);
  }
  return new NumberPropertySelector(prop);
}
const NoPropertySelector = {
  selectProperty(file) {
    return 0;
  }
};
const FileCreationSelector = {
  selectProperty(file) {
    return file.createdAt();
  }
};
const FileModificationSelector = {
  selectProperty(file) {
    return file.modifiedAt();
  }
};
class DatePropertySelector {
  constructor(property) {
    this.property = property;
  }
  selectProperty(file) {
    const metadata = file.metadata();
    if (metadata == null) {
      return 0;
    }
    const value = metadata[this.property];
    if (value == null)
      return 0;
    const date = new Date(value);
    const valueOf = date.valueOf();
    return valueOf;
  }
}
class NumberPropertySelector {
  constructor(property) {
    this.property = property;
  }
  selectProperty(file) {
    const metadata = file.metadata();
    if (metadata == null) {
      return 0;
    }
    const value = metadata[this.property];
    if (value == null)
      return 0;
    if (typeof value === "string") {
      return parseInt(value);
    }
    return value;
  }
}
const GroupForm_svelte_svelte_type_style_lang = "";
function create_default_slot$3(ctx) {
  let svg;
  let line0;
  let line1;
  return {
    c() {
      svg = svg_element("svg");
      line0 = svg_element("line");
      line1 = svg_element("line");
      attr(line0, "x1", "18");
      attr(line0, "y1", "6");
      attr(line0, "x2", "6");
      attr(line0, "y2", "18");
      attr(line1, "x1", "6");
      attr(line1, "y1", "6");
      attr(line1, "x2", "18");
      attr(line1, "y2", "18");
      attr(svg, "xmlns", "http://www.w3.org/2000/svg");
      attr(svg, "width", "24");
      attr(svg, "height", "24");
      attr(svg, "viewBox", "0 0 24 24");
      attr(svg, "fill", "none");
      attr(svg, "stroke", "currentColor");
      attr(svg, "stroke-width", "2");
      attr(svg, "stroke-linecap", "round");
      attr(svg, "stroke-linejoin", "round");
      attr(svg, "class", "svg-icon lucide-x");
    },
    m(target, anchor) {
      insert(target, svg, anchor);
      append(svg, line0);
      append(svg, line1);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(svg);
      }
    }
  };
}
function create_fragment$b(ctx) {
  let fieldset;
  let input0;
  let t0;
  let input1;
  let t1;
  let actionbutton;
  let fieldset_class_value;
  let current;
  let mounted;
  let dispose;
  actionbutton = new ActionButton({
    props: {
      class: "clickable-icon",
      "aria-label": "Delete group",
      $$slots: { default: [create_default_slot$3] },
      $$scope: { ctx }
    }
  });
  actionbutton.$on(
    "action",
    /*action_handler*/
    ctx[17]
  );
  return {
    c() {
      fieldset = element("fieldset");
      input0 = element("input");
      t0 = space();
      input1 = element("input");
      t1 = space();
      create_component(actionbutton.$$.fragment);
      attr(input0, "type", "text");
      attr(input0, "spellcheck", "false");
      attr(input0, "placeholder", "Enter query...");
      attr(input1, "type", "color");
      attr(input1, "aria-label", "Click to change color\nDrag to reorder groups");
      attr(input1, "class", "svelte-d7uxyt");
      attr(
        fieldset,
        "style",
        /*style*/
        ctx[0]
      );
      attr(fieldset, "class", fieldset_class_value = /*dragging*/
      (ctx[3] ? "dragging" : "") + " " + /*pushDown*/
      (ctx[4] ? "pushDown" : "") + " svelte-d7uxyt");
    },
    m(target, anchor) {
      insert(target, fieldset, anchor);
      append(fieldset, input0);
      set_input_value(
        input0,
        /*$query*/
        ctx[6]
      );
      append(fieldset, t0);
      append(fieldset, input1);
      set_input_value(
        input1,
        /*$color*/
        ctx[7]
      );
      append(fieldset, t1);
      mount_component(actionbutton, fieldset, null);
      ctx[18](fieldset);
      current = true;
      if (!mounted) {
        dispose = [
          listen(
            input0,
            "input",
            /*input0_input_handler*/
            ctx[15]
          ),
          listen(
            input1,
            "input",
            /*input1_input_handler*/
            ctx[16]
          ),
          listen(
            input1,
            "mousedown",
            /*primeDrag*/
            ctx[10]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (dirty & /*$query*/
      64 && input0.value !== /*$query*/
      ctx2[6]) {
        set_input_value(
          input0,
          /*$query*/
          ctx2[6]
        );
      }
      if (dirty & /*$color*/
      128) {
        set_input_value(
          input1,
          /*$color*/
          ctx2[7]
        );
      }
      const actionbutton_changes = {};
      if (dirty & /*$$scope*/
      1048576) {
        actionbutton_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton.$set(actionbutton_changes);
      if (!current || dirty & /*style*/
      1) {
        attr(
          fieldset,
          "style",
          /*style*/
          ctx2[0]
        );
      }
      if (!current || dirty & /*dragging, pushDown*/
      24 && fieldset_class_value !== (fieldset_class_value = /*dragging*/
      (ctx2[3] ? "dragging" : "") + " " + /*pushDown*/
      (ctx2[4] ? "pushDown" : "") + " svelte-d7uxyt")) {
        attr(fieldset, "class", fieldset_class_value);
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(actionbutton.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(actionbutton.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(fieldset);
      }
      destroy_component(actionbutton);
      ctx[18](null);
      mounted = false;
      run_all(dispose);
    }
  };
}
function instance$8($$self, $$props, $$invalidate) {
  let $query;
  let $color;
  let { style = "" } = $$props;
  let { group: group2 } = $$props;
  let { groups = void 0 } = $$props;
  let { dragging = false } = $$props;
  let { pushDown = false } = $$props;
  let { clientWidth = 0 } = $$props;
  let { clientHeight = 0 } = $$props;
  let { innerWidth = 0 } = $$props;
  let { innerHeight = 0 } = $$props;
  const dispatch2 = createEventDispatcher();
  const query = writable(group2.query);
  component_subscribe($$self, query, (value) => $$invalidate(6, $query = value));
  query.subscribe((newQuery) => {
    if (newQuery !== group2.query) {
      groups == null ? void 0 : groups.applyFileToGroup(group2.id, newQuery);
    }
  });
  const color = writable(group2.color);
  component_subscribe($$self, color, (value) => $$invalidate(7, $color = value));
  color.subscribe((newColor) => {
    if (newColor !== group2.color) {
      groups == null ? void 0 : groups.recolorGroup(group2.id, newColor);
    }
  });
  let element2;
  onMount(() => {
    if (element2 == null)
      return;
    new ResizeObserver(() => {
      if (element2 == null)
        return;
      $$invalidate(11, clientWidth = element2.clientWidth);
      $$invalidate(12, clientHeight = element2.clientHeight);
      $$invalidate(13, innerWidth = element2.innerWidth);
      $$invalidate(14, innerHeight = element2.innerHeight);
    }).observe(element2);
  });
  function primeDrag(event) {
    const offsetX = event.currentTarget.offsetLeft + event.offsetX;
    const offsetY = event.currentTarget.offsetTop + event.offsetY;
    dispatch2("primeDrag", { offsetX, offsetY });
  }
  function input0_input_handler() {
    $query = this.value;
    query.set($query);
  }
  function input1_input_handler() {
    $color = this.value;
    color.set($color);
  }
  const action_handler = () => groups == null ? void 0 : groups.removeGroup(group2.id);
  function fieldset_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      element2 = $$value;
      $$invalidate(5, element2);
    });
  }
  $$self.$$set = ($$props2) => {
    if ("style" in $$props2)
      $$invalidate(0, style = $$props2.style);
    if ("group" in $$props2)
      $$invalidate(1, group2 = $$props2.group);
    if ("groups" in $$props2)
      $$invalidate(2, groups = $$props2.groups);
    if ("dragging" in $$props2)
      $$invalidate(3, dragging = $$props2.dragging);
    if ("pushDown" in $$props2)
      $$invalidate(4, pushDown = $$props2.pushDown);
    if ("clientWidth" in $$props2)
      $$invalidate(11, clientWidth = $$props2.clientWidth);
    if ("clientHeight" in $$props2)
      $$invalidate(12, clientHeight = $$props2.clientHeight);
    if ("innerWidth" in $$props2)
      $$invalidate(13, innerWidth = $$props2.innerWidth);
    if ("innerHeight" in $$props2)
      $$invalidate(14, innerHeight = $$props2.innerHeight);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty & /*group*/
    2) {
      query.set(group2.query);
    }
    if ($$self.$$.dirty & /*group*/
    2) {
      color.set(group2.color);
    }
  };
  return [
    style,
    group2,
    groups,
    dragging,
    pushDown,
    element2,
    $query,
    $color,
    query,
    color,
    primeDrag,
    clientWidth,
    clientHeight,
    innerWidth,
    innerHeight,
    input0_input_handler,
    input1_input_handler,
    action_handler,
    fieldset_binding
  ];
}
class GroupForm extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$8, create_fragment$b, safe_not_equal, {
      style: 0,
      group: 1,
      groups: 2,
      dragging: 3,
      pushDown: 4,
      clientWidth: 11,
      clientHeight: 12,
      innerWidth: 13,
      innerHeight: 14
    });
  }
}
const Groups_svelte_svelte_type_style_lang = "";
const { Map: Map_1 } = globals;
function get_each_context_1(ctx, list, i) {
  const child_ctx = ctx.slice();
  child_ctx[34] = list[i];
  child_ctx[36] = i;
  return child_ctx;
}
function get_each_context$1(ctx, list, i) {
  const child_ctx = ctx.slice();
  child_ctx[34] = list[i];
  child_ctx[36] = i;
  return child_ctx;
}
function create_else_block(ctx) {
  let each_1_anchor;
  let current;
  let each_value_1 = ensure_array_like(
    /*groups*/
    ctx[3]
  );
  let each_blocks = [];
  for (let i = 0; i < each_value_1.length; i += 1) {
    each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
  }
  const out = (i) => transition_out(each_blocks[i], 1, 1, () => {
    each_blocks[i] = null;
  });
  return {
    c() {
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].c();
      }
      each_1_anchor = empty();
    },
    m(target, anchor) {
      for (let i = 0; i < each_blocks.length; i += 1) {
        if (each_blocks[i]) {
          each_blocks[i].m(target, anchor);
        }
      }
      insert(target, each_1_anchor, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*groups, timelineItemGroups, groupFormWidth, groupFormHeight, groupFormInnerHeight, primeDrag*/
      4217) {
        each_value_1 = ensure_array_like(
          /*groups*/
          ctx2[3]
        );
        let i;
        for (i = 0; i < each_value_1.length; i += 1) {
          const child_ctx = get_each_context_1(ctx2, each_value_1, i);
          if (each_blocks[i]) {
            each_blocks[i].p(child_ctx, dirty);
            transition_in(each_blocks[i], 1);
          } else {
            each_blocks[i] = create_each_block_1(child_ctx);
            each_blocks[i].c();
            transition_in(each_blocks[i], 1);
            each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
          }
        }
        group_outros();
        for (i = each_value_1.length; i < each_blocks.length; i += 1) {
          out(i);
        }
        check_outros();
      }
    },
    i(local) {
      if (current)
        return;
      for (let i = 0; i < each_value_1.length; i += 1) {
        transition_in(each_blocks[i]);
      }
      current = true;
    },
    o(local) {
      each_blocks = each_blocks.filter(Boolean);
      for (let i = 0; i < each_blocks.length; i += 1) {
        transition_out(each_blocks[i]);
      }
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(each_1_anchor);
      }
      destroy_each(each_blocks, detaching);
    }
  };
}
function create_if_block_1$1(ctx) {
  let each_blocks = [];
  let each_1_lookup = new Map_1();
  let each_1_anchor;
  let current;
  let each_value = ensure_array_like(
    /*groups*/
    ctx[3].filter(
      /*func*/
      ctx[20]
    )
  );
  const get_key = (ctx2) => (
    /*index*/
    ctx2[36]
  );
  for (let i = 0; i < each_value.length; i += 1) {
    let child_ctx = get_each_context$1(ctx, each_value, i);
    let key = get_key(child_ctx);
    each_1_lookup.set(key, each_blocks[i] = create_each_block$1(key, child_ctx));
  }
  return {
    c() {
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].c();
      }
      each_1_anchor = empty();
    },
    m(target, anchor) {
      for (let i = 0; i < each_blocks.length; i += 1) {
        if (each_blocks[i]) {
          each_blocks[i].m(target, anchor);
        }
      }
      insert(target, each_1_anchor, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*groups, dragIndex, dragOverIndex*/
      392) {
        each_value = ensure_array_like(
          /*groups*/
          ctx2[3].filter(
            /*func*/
            ctx2[20]
          )
        );
        group_outros();
        each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx2, each_value, each_1_lookup, each_1_anchor.parentNode, outro_and_destroy_block, create_each_block$1, each_1_anchor, get_each_context$1);
        check_outros();
      }
    },
    i(local) {
      if (current)
        return;
      for (let i = 0; i < each_value.length; i += 1) {
        transition_in(each_blocks[i]);
      }
      current = true;
    },
    o(local) {
      for (let i = 0; i < each_blocks.length; i += 1) {
        transition_out(each_blocks[i]);
      }
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(each_1_anchor);
      }
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].d(detaching);
      }
    }
  };
}
function create_each_block_1(ctx) {
  let groupform;
  let updating_clientWidth;
  let updating_clientHeight;
  let updating_innerHeight;
  let current;
  function groupform_clientWidth_binding(value) {
    ctx[21](value);
  }
  function groupform_clientHeight_binding(value) {
    ctx[22](value);
  }
  function groupform_innerHeight_binding(value) {
    ctx[23](value);
  }
  function remove_handler() {
    return (
      /*remove_handler*/
      ctx[24](
        /*group*/
        ctx[34]
      )
    );
  }
  function primeDrag_handler(...args) {
    return (
      /*primeDrag_handler*/
      ctx[25](
        /*index*/
        ctx[36],
        ...args
      )
    );
  }
  let groupform_props = {
    group: (
      /*group*/
      ctx[34]
    ),
    groups: (
      /*timelineItemGroups*/
      ctx[0]
    )
  };
  if (
    /*groupFormWidth*/
    ctx[4] !== void 0
  ) {
    groupform_props.clientWidth = /*groupFormWidth*/
    ctx[4];
  }
  if (
    /*groupFormHeight*/
    ctx[5] !== void 0
  ) {
    groupform_props.clientHeight = /*groupFormHeight*/
    ctx[5];
  }
  if (
    /*groupFormInnerHeight*/
    ctx[6] !== void 0
  ) {
    groupform_props.innerHeight = /*groupFormInnerHeight*/
    ctx[6];
  }
  groupform = new GroupForm({ props: groupform_props });
  binding_callbacks.push(() => bind(groupform, "clientWidth", groupform_clientWidth_binding));
  binding_callbacks.push(() => bind(groupform, "clientHeight", groupform_clientHeight_binding));
  binding_callbacks.push(() => bind(groupform, "innerHeight", groupform_innerHeight_binding));
  groupform.$on("remove", remove_handler);
  groupform.$on("primeDrag", primeDrag_handler);
  return {
    c() {
      create_component(groupform.$$.fragment);
    },
    m(target, anchor) {
      mount_component(groupform, target, anchor);
      current = true;
    },
    p(new_ctx, dirty) {
      ctx = new_ctx;
      const groupform_changes = {};
      if (dirty[0] & /*groups*/
      8)
        groupform_changes.group = /*group*/
        ctx[34];
      if (dirty[0] & /*timelineItemGroups*/
      1)
        groupform_changes.groups = /*timelineItemGroups*/
        ctx[0];
      if (!updating_clientWidth && dirty[0] & /*groupFormWidth*/
      16) {
        updating_clientWidth = true;
        groupform_changes.clientWidth = /*groupFormWidth*/
        ctx[4];
        add_flush_callback(() => updating_clientWidth = false);
      }
      if (!updating_clientHeight && dirty[0] & /*groupFormHeight*/
      32) {
        updating_clientHeight = true;
        groupform_changes.clientHeight = /*groupFormHeight*/
        ctx[5];
        add_flush_callback(() => updating_clientHeight = false);
      }
      if (!updating_innerHeight && dirty[0] & /*groupFormInnerHeight*/
      64) {
        updating_innerHeight = true;
        groupform_changes.innerHeight = /*groupFormInnerHeight*/
        ctx[6];
        add_flush_callback(() => updating_innerHeight = false);
      }
      groupform.$set(groupform_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(groupform.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(groupform.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(groupform, detaching);
    }
  };
}
function create_each_block$1(key_1, ctx) {
  let first;
  let groupform;
  let current;
  groupform = new GroupForm({
    props: {
      group: (
        /*group*/
        ctx[34]
      ),
      pushDown: (
        /*dragOverIndex*/
        ctx[8] >= 0 && /*index*/
        ctx[36] >= /*dragOverIndex*/
        ctx[8]
      )
    }
  });
  return {
    key: key_1,
    first: null,
    c() {
      first = empty();
      create_component(groupform.$$.fragment);
      this.first = first;
    },
    m(target, anchor) {
      insert(target, first, anchor);
      mount_component(groupform, target, anchor);
      current = true;
    },
    p(new_ctx, dirty) {
      ctx = new_ctx;
      const groupform_changes = {};
      if (dirty[0] & /*groups, dragIndex*/
      136)
        groupform_changes.group = /*group*/
        ctx[34];
      if (dirty[0] & /*dragOverIndex, groups, dragIndex*/
      392)
        groupform_changes.pushDown = /*dragOverIndex*/
        ctx[8] >= 0 && /*index*/
        ctx[36] >= /*dragOverIndex*/
        ctx[8];
      groupform.$set(groupform_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(groupform.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(groupform.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(first);
      }
      destroy_component(groupform, detaching);
    }
  };
}
function create_default_slot_1$1(ctx) {
  let t;
  return {
    c() {
      t = text("New group");
    },
    m(target, anchor) {
      insert(target, t, anchor);
    },
    d(detaching) {
      if (detaching) {
        detach(t);
      }
    }
  };
}
function create_default_slot$2(ctx) {
  let div0;
  let current_block_type_index;
  let if_block;
  let t;
  let div1;
  let actionbutton;
  let current;
  let mounted;
  let dispose;
  const if_block_creators = [create_if_block_1$1, create_else_block];
  const if_blocks = [];
  function select_block_type(ctx2, dirty) {
    if (
      /*dragIndex*/
      ctx2[7] >= 0
    )
      return 0;
    return 1;
  }
  current_block_type_index = select_block_type(ctx);
  if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  actionbutton = new ActionButton({
    props: {
      class: "mod-cta",
      $$slots: { default: [create_default_slot_1$1] },
      $$scope: { ctx }
    }
  });
  actionbutton.$on(
    "action",
    /*action_handler*/
    ctx[26]
  );
  return {
    c() {
      div0 = element("div");
      if_block.c();
      t = space();
      div1 = element("div");
      create_component(actionbutton.$$.fragment);
      attr(div0, "class", "group-list svelte-134nxms");
      attr(div0, "role", "list");
      set_style(
        div0,
        "--form-height",
        /*groupFormHeight*/
        ctx[5] + "px"
      );
      toggle_class(
        div0,
        "dragging",
        /*dragIndex*/
        ctx[7] >= 0
      );
      attr(div1, "class", "graph-color-button-container svelte-134nxms");
    },
    m(target, anchor) {
      insert(target, div0, anchor);
      if_blocks[current_block_type_index].m(div0, null);
      insert(target, t, anchor);
      insert(target, div1, anchor);
      mount_component(actionbutton, div1, null);
      current = true;
      if (!mounted) {
        dispose = listen(
          div0,
          "mousemove",
          /*relativeMouseMove*/
          ctx[13]
        );
        mounted = true;
      }
    },
    p(ctx2, dirty) {
      let previous_block_index = current_block_type_index;
      current_block_type_index = select_block_type(ctx2);
      if (current_block_type_index === previous_block_index) {
        if_blocks[current_block_type_index].p(ctx2, dirty);
      } else {
        group_outros();
        transition_out(if_blocks[previous_block_index], 1, 1, () => {
          if_blocks[previous_block_index] = null;
        });
        check_outros();
        if_block = if_blocks[current_block_type_index];
        if (!if_block) {
          if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx2);
          if_block.c();
        } else {
          if_block.p(ctx2, dirty);
        }
        transition_in(if_block, 1);
        if_block.m(div0, null);
      }
      if (!current || dirty[0] & /*groupFormHeight*/
      32) {
        set_style(
          div0,
          "--form-height",
          /*groupFormHeight*/
          ctx2[5] + "px"
        );
      }
      if (!current || dirty[0] & /*dragIndex*/
      128) {
        toggle_class(
          div0,
          "dragging",
          /*dragIndex*/
          ctx2[7] >= 0
        );
      }
      const actionbutton_changes = {};
      if (dirty[1] & /*$$scope*/
      128) {
        actionbutton_changes.$$scope = { dirty, ctx: ctx2 };
      }
      actionbutton.$set(actionbutton_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(if_block);
      transition_in(actionbutton.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(if_block);
      transition_out(actionbutton.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(div0);
        detach(t);
        detach(div1);
      }
      if_blocks[current_block_type_index].d();
      destroy_component(actionbutton);
      mounted = false;
      dispose();
    }
  };
}
function create_if_block$2(ctx) {
  let dialog;
  let groupform;
  let current;
  groupform = new GroupForm({
    props: {
      group: (
        /*groups*/
        ctx[3][
          /*dragIndex*/
          ctx[7]
        ]
      )
    }
  });
  return {
    c() {
      dialog = element("dialog");
      create_component(groupform.$$.fragment);
      dialog.open = true;
      set_style(
        dialog,
        "top",
        /*dragImgPos*/
        ctx[9].top + "px"
      );
      set_style(
        dialog,
        "left",
        /*dragImgPos*/
        ctx[9].left + "px"
      );
      attr(dialog, "class", "svelte-134nxms");
    },
    m(target, anchor) {
      insert(target, dialog, anchor);
      mount_component(groupform, dialog, null);
      ctx[28](dialog);
      current = true;
    },
    p(ctx2, dirty) {
      const groupform_changes = {};
      if (dirty[0] & /*groups, dragIndex*/
      136)
        groupform_changes.group = /*groups*/
        ctx2[3][
          /*dragIndex*/
          ctx2[7]
        ];
      groupform.$set(groupform_changes);
      if (!current || dirty[0] & /*dragImgPos*/
      512) {
        set_style(
          dialog,
          "top",
          /*dragImgPos*/
          ctx2[9].top + "px"
        );
      }
      if (!current || dirty[0] & /*dragImgPos*/
      512) {
        set_style(
          dialog,
          "left",
          /*dragImgPos*/
          ctx2[9].left + "px"
        );
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(groupform.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(groupform.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(dialog);
      }
      destroy_component(groupform);
      ctx[28](null);
    }
  };
}
function create_fragment$a(ctx) {
  let collapsablesection;
  let updating_collapsed;
  let t;
  let if_block_anchor;
  let current;
  function collapsablesection_collapsed_binding(value) {
    ctx[27](value);
  }
  let collapsablesection_props = {
    name: (
      /*name*/
      ctx[1]
    ),
    $$slots: { default: [create_default_slot$2] },
    $$scope: { ctx }
  };
  if (
    /*$collapsed*/
    ctx[10] !== void 0
  ) {
    collapsablesection_props.collapsed = /*$collapsed*/
    ctx[10];
  }
  collapsablesection = new CollapsableSection({ props: collapsablesection_props });
  binding_callbacks.push(() => bind(collapsablesection, "collapsed", collapsablesection_collapsed_binding));
  let if_block = (
    /*dragIndex*/
    ctx[7] >= 0 && create_if_block$2(ctx)
  );
  return {
    c() {
      create_component(collapsablesection.$$.fragment);
      t = space();
      if (if_block)
        if_block.c();
      if_block_anchor = empty();
    },
    m(target, anchor) {
      mount_component(collapsablesection, target, anchor);
      insert(target, t, anchor);
      if (if_block)
        if_block.m(target, anchor);
      insert(target, if_block_anchor, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const collapsablesection_changes = {};
      if (dirty[0] & /*name*/
      2)
        collapsablesection_changes.name = /*name*/
        ctx2[1];
      if (dirty[0] & /*timelineItemGroups, groupFormHeight, dragIndex, groups, dragOverIndex, groupFormWidth, groupFormInnerHeight*/
      505 | dirty[1] & /*$$scope*/
      128) {
        collapsablesection_changes.$$scope = { dirty, ctx: ctx2 };
      }
      if (!updating_collapsed && dirty[0] & /*$collapsed*/
      1024) {
        updating_collapsed = true;
        collapsablesection_changes.collapsed = /*$collapsed*/
        ctx2[10];
        add_flush_callback(() => updating_collapsed = false);
      }
      collapsablesection.$set(collapsablesection_changes);
      if (
        /*dragIndex*/
        ctx2[7] >= 0
      ) {
        if (if_block) {
          if_block.p(ctx2, dirty);
          if (dirty[0] & /*dragIndex*/
          128) {
            transition_in(if_block, 1);
          }
        } else {
          if_block = create_if_block$2(ctx2);
          if_block.c();
          transition_in(if_block, 1);
          if_block.m(if_block_anchor.parentNode, if_block_anchor);
        }
      } else if (if_block) {
        group_outros();
        transition_out(if_block, 1, 1, () => {
          if_block = null;
        });
        check_outros();
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(collapsablesection.$$.fragment, local);
      transition_in(if_block);
      current = true;
    },
    o(local) {
      transition_out(collapsablesection.$$.fragment, local);
      transition_out(if_block);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(t);
        detach(if_block_anchor);
      }
      destroy_component(collapsablesection, detaching);
      if (if_block)
        if_block.d(detaching);
    }
  };
}
function instance$7($$self, $$props, $$invalidate) {
  let $collapsed;
  let { timelineItemGroups } = $$props;
  let { name } = $$props;
  let { viewModel } = $$props;
  const collapsed = viewModel.make("collapsed", true);
  component_subscribe($$self, collapsed, (value) => $$invalidate(10, $collapsed = value));
  const groupById = /* @__PURE__ */ new Map();
  let groups = [...timelineItemGroups.listGroups()];
  groups.forEach((group2) => groupById.set(group2.id, group2));
  function addGroup(group2) {
    groupById.set(group2.id, group2);
    groups.push(group2);
    $$invalidate(3, groups);
  }
  function recolorGroup2(group2) {
    groupById.set(group2.id, group2);
    $$invalidate(3, groups = groups.map(({ id }) => groupById.get(id)));
  }
  function changeGroupQuery(group2) {
    groupById.set(group2.id, group2);
    $$invalidate(3, groups = groups.map(({ id }) => groupById.get(id)));
  }
  function removeGroup2(groupId) {
    groupById.delete(groupId);
    $$invalidate(3, groups = groups.filter(({ id }) => id !== groupId).map(({ id }) => groupById.get(id)));
  }
  function newOrder(newGroups) {
    groupById.clear();
    newGroups.forEach((group2) => groupById.set(group2.id, group2));
    $$invalidate(3, groups = [...newGroups]);
  }
  let groupFormWidth = 0;
  let groupFormHeight = 0;
  let groupFormInnerHeight = 0;
  let primedDragIndex = -1;
  let dragIndex = -1;
  let dragOverIndex = -1;
  let dragHandle = { offsetX: 0, offsetY: 0 };
  let dragImgPos = { top: 0, left: 0 };
  function primeDrag(index, position) {
    primedDragIndex = index;
    dragHandle = position;
    $$invalidate(9, dragImgPos = {
      left: position.offsetX,
      top: position.offsetY
    });
    window.addEventListener("mousemove", mousemove);
    window.addEventListener("mouseup", endDrag);
  }
  function mousemove(event) {
    $$invalidate(7, dragIndex = primedDragIndex);
    $$invalidate(9, dragImgPos = {
      top: event.pageY - dragHandle.offsetY,
      left: event.pageX - dragHandle.offsetX
    });
  }
  function endDrag() {
    window.removeEventListener("mousemove", mousemove);
    window.removeEventListener("mouseup", endDrag);
    timelineItemGroups.reorderGroup(groups[dragIndex].id, dragOverIndex);
    $$invalidate(7, dragIndex = -1);
    $$invalidate(8, dragOverIndex = -1);
  }
  function relativeMouseMove(event) {
    if (dragIndex < 0)
      return;
    const currentTargetY = event.pageY - event.currentTarget.getBoundingClientRect().top;
    $$invalidate(8, dragOverIndex = Math.floor(currentTargetY / groupFormHeight));
  }
  let dragDialog;
  const func = (_, index) => index !== dragIndex;
  function groupform_clientWidth_binding(value) {
    groupFormWidth = value;
    $$invalidate(4, groupFormWidth);
  }
  function groupform_clientHeight_binding(value) {
    groupFormHeight = value;
    $$invalidate(5, groupFormHeight);
  }
  function groupform_innerHeight_binding(value) {
    groupFormInnerHeight = value;
    $$invalidate(6, groupFormInnerHeight);
  }
  const remove_handler = (group2) => timelineItemGroups.removeGroup(group2.id);
  const primeDrag_handler = (index, { detail }) => primeDrag(index, detail);
  const action_handler = () => timelineItemGroups.createNewGroup();
  function collapsablesection_collapsed_binding(value) {
    $collapsed = value;
    collapsed.set($collapsed);
  }
  function dialog_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      dragDialog = $$value;
      $$invalidate(2, dragDialog);
    });
  }
  $$self.$$set = ($$props2) => {
    if ("timelineItemGroups" in $$props2)
      $$invalidate(0, timelineItemGroups = $$props2.timelineItemGroups);
    if ("name" in $$props2)
      $$invalidate(1, name = $$props2.name);
    if ("viewModel" in $$props2)
      $$invalidate(14, viewModel = $$props2.viewModel);
  };
  $$self.$$.update = () => {
    var _a, _b;
    if ($$self.$$.dirty[0] & /*dragDialog*/
    4) {
      if (dragDialog != null) {
        if (dragDialog.parentElement != dragDialog.ownerDocument.body) {
          (_b = (_a = dragDialog.ownerDocument) == null ? void 0 : _a.body) == null ? void 0 : _b.appendChild(dragDialog);
        }
      }
    }
  };
  return [
    timelineItemGroups,
    name,
    dragDialog,
    groups,
    groupFormWidth,
    groupFormHeight,
    groupFormInnerHeight,
    dragIndex,
    dragOverIndex,
    dragImgPos,
    $collapsed,
    collapsed,
    primeDrag,
    relativeMouseMove,
    viewModel,
    addGroup,
    recolorGroup2,
    changeGroupQuery,
    removeGroup2,
    newOrder,
    func,
    groupform_clientWidth_binding,
    groupform_clientHeight_binding,
    groupform_innerHeight_binding,
    remove_handler,
    primeDrag_handler,
    action_handler,
    collapsablesection_collapsed_binding,
    dialog_binding
  ];
}
class Groups extends SvelteComponent {
  constructor(options) {
    super();
    init(
      this,
      options,
      instance$7,
      create_fragment$a,
      safe_not_equal,
      {
        timelineItemGroups: 0,
        name: 1,
        viewModel: 14,
        addGroup: 15,
        recolorGroup: 16,
        changeGroupQuery: 17,
        removeGroup: 18,
        newOrder: 19
      },
      null,
      [-1, -1]
    );
  }
  get addGroup() {
    return this.$$.ctx[15];
  }
  get recolorGroup() {
    return this.$$.ctx[16];
  }
  get changeGroupQuery() {
    return this.$$.ctx[17];
  }
  get removeGroup() {
    return this.$$.ctx[18];
  }
  get newOrder() {
    return this.$$.ctx[19];
  }
}
const MatchAllEmptyQuery = {
  async appliesTo(file) {
    return true;
  },
  and(filter) {
    return filter;
  },
  or(filter) {
    return filter;
  }
};
async function selectGroupForFile(groups, file) {
  for (const group2 of groups) {
    if (await file.matches(group2.filter)) {
      return group2;
    }
  }
}
const processLog = () => {
};
let latestProcessId = 0;
function longProcess(items, processItem) {
  const processInstance = new LongProcess(++latestProcessId, processItem);
  processInstance.processBatch(0, items);
  return processInstance;
}
class LongProcess {
  constructor(id, processItem) {
    __publicField(this, "processing", true);
    __publicField(this, "_completion");
    __publicField(this, "_resolve");
    __publicField(this, "_reject");
    this.id = id;
    this.processItem = processItem;
  }
  stop() {
    this.processing = false;
  }
  completion() {
    if (this._completion == null) {
      this._completion = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
    }
    return this._completion;
  }
  async processBatch(i, items) {
    var _a, _b;
    const start = performance.now();
    for (i; i < items.length; i++) {
      if (!this.processing) {
        processLog(`  [${this.id}] CANCELLED`);
        (_a = this._reject) == null ? void 0 : _a.call(null, "Cancelled");
        return;
      }
      if (i % 1e3 === 0) {
        processLog(`  [${this.id}] Processed`);
      }
      await this.processItem(items[i]);
      const elapsedTime = performance.now() - start;
      if (elapsedTime > 16.67) {
        break;
      }
    }
    if (i < items.length) {
      setTimeout(() => this.processBatch(i, items), 0);
    } else {
      processLog(`[${this.id}] COMPLETE`);
      (_b = this._resolve) == null ? void 0 : _b.call(null, void 0);
    }
  }
}
async function applyFileToGroup(groupId, query, output) {
  var _a;
  const group2 = this.groups.getGroup(groupId);
  if (group2 == null)
    return;
  const order = this.groups.getOrder();
  const groupIndex = order.indexOf(groupId);
  if (groupIndex < 0)
    return;
  let dependentGroups = order.slice(groupIndex);
  (_a = this.recolorProcess) == null ? void 0 : _a.stop();
  this.recolorProcess = void 0;
  group2.query = query;
  this.groups.saveGroup(group2);
  output.presentRequeriedGroup(group2);
  const groups = this.groups.list();
  const selectGroup = selectGroupForFile.bind(null, groups);
  const affectedItems = this.items.list().filter((item) => {
    const itemGroup = item.group();
    return itemGroup == null || dependentGroups.includes(itemGroup);
  });
  for (const item of affectedItems) {
    item.forgetGroup();
  }
  const process = longProcess(affectedItems, async (item) => {
    const group22 = await selectGroup(item.obsidianFile);
    item.applyGroup(group22);
    output.presentRecoloredItem(item);
  });
  this.recolorProcess = process;
  try {
    await process.completion();
  } catch (e) {
    if (typeof e === "string" && e === "Cancelled")
      ;
    else {
      throw e;
    }
  }
  this.recolorProcess = void 0;
}
function recolorGroup(groupId, color, output) {
  var _a;
  const group2 = this.groups.getGroup(groupId);
  if (group2 == null)
    return;
  (_a = this.recolorProcess) == null ? void 0 : _a.stop();
  this.recolorProcess = void 0;
  group2.color = color;
  this.groups.saveGroup(group2);
  output.presentRecoloredGroup(group2);
  const items = this.items.list().filter((it) => it.group() === groupId);
  for (const item of items) {
    item.applyGroup(group2);
  }
  output.presentRecoloredItems(items);
}
async function removeGroup(groupId, output) {
  var _a;
  if (!this.groups.removeGroup(groupId)) {
    return;
  }
  (_a = this.recolorProcess) == null ? void 0 : _a.stop();
  this.recolorProcess = void 0;
  const groups = this.groups.list();
  output.hideGroup(groupId);
  const items = this.items.list().filter((it) => it.group() === groupId || it.group() == null);
  for (const item of items) {
    item.forgetGroup();
  }
  const selectGroup = selectGroupForFile.bind(null, groups);
  const process = longProcess(items, async (item) => {
    const group2 = await selectGroup(item.obsidianFile);
    item.applyGroup(group2);
    output.presentRecoloredItem(item);
  });
  this.recolorProcess = process;
  try {
    await process.completion();
  } catch (e) {
    if (typeof e === "string" && e === "Cancelled")
      ;
    else {
      throw e;
    }
  }
  this.recolorProcess = void 0;
}
function listExistingGroups(output) {
  const groups = this.groups.list();
  output.presentGroups(groups);
}
const defaultGroupColors = [
  "#e05252",
  "#e0b152",
  "#b1e052",
  "#52e052",
  "#52e0b1",
  "#52b1e0",
  "#5252e0",
  "#b152e0",
  "#e052b1"
];
async function createNewGroup(output) {
  const color = defaultGroupColors[this.groups.list().length % defaultGroupColors.length];
  const group2 = this.groups.addNewGroup({ query: "", color });
  this.groups.list();
  output.presentNewGroup(group2);
}
async function reorderGroup(groupId, toIndex, output) {
  var _a;
  const order = this.groups.getOrder();
  const index = order.indexOf(groupId);
  if (index < 0) {
    return;
  }
  (_a = this.recolorProcess) == null ? void 0 : _a.stop();
  this.recolorProcess = void 0;
  const newOrder = order.toSpliced(index, 1);
  newOrder.splice(toIndex, 0, groupId);
  this.groups.setOrder(newOrder);
  const groups = this.groups.list();
  output.presentReorderedGroups(groups);
  for (const item of this.items.list()) {
    item.forgetGroup();
  }
  const selectGroup = selectGroupForFile.bind(null, groups);
  const process = longProcess(this.items.list(), async (item) => {
    const group2 = await selectGroup(item.obsidianFile);
    item.applyGroup(group2);
    output.presentRecoloredItem(item);
  });
  this.recolorProcess = process;
  try {
    await process.completion();
  } catch (e) {
    if (typeof e === "string" && e === "Cancelled")
      ;
    else {
      throw e;
    }
  }
  this.recolorProcess = void 0;
}
function makeTimelineItemGroups(context, output) {
  return new TimelineItemGroupsImpl(
    context,
    output
  );
}
class TimelineItemGroupsImpl {
  constructor(context, output) {
    this.context = context;
    this.output = output;
  }
  createNewGroup() {
    createNewGroup.call(this.context, this.output);
  }
  applyFileToGroup(groupId, query) {
    applyFileToGroup.call(this.context, groupId, query, this.output);
  }
  recolorGroup(groupId, color) {
    recolorGroup.call(this.context, groupId, color, this.output);
  }
  removeGroup(groupId) {
    removeGroup.call(this.context, groupId, this.output);
  }
  reorderGroup(groupId, toIndex) {
    reorderGroup.call(this.context, groupId, toIndex, this.output);
  }
  listGroups() {
    let receivedGroups = [];
    listExistingGroups.call(this.context, {
      presentGroups(groups) {
        receivedGroups = groups;
      }
    });
    return receivedGroups;
  }
}
class GroupRepository {
  constructor(storedGroups, files2) {
    __publicField(this, "order", []);
    __publicField(this, "groups", /* @__PURE__ */ new Map());
    __publicField(this, "nextId");
    this.storedGroups = storedGroups;
    this.files = files2;
    get_store_value(storedGroups).forEach((storedGroup2, index) => {
      const id = index.toString();
      const group2 = new TimelineFileItemGroup(id, files2, storedGroup2);
      this.order.push(id);
      this.groups.set(id, group2);
    });
    this.nextId = this.groups.size;
  }
  getOrder() {
    return this.order;
  }
  addNewGroup(data) {
    this.nextId++;
    const group2 = new TimelineFileItemGroup(this.nextId.toString(), this.files, data);
    this.groups.set(group2.id, group2);
    this.order.push(group2.id);
    this.storedGroups.update((currentStoredGroups) => {
      currentStoredGroups.push(data);
      return currentStoredGroups;
    });
    return group2;
  }
  getGroup(groupId) {
    return this.groups.get(groupId);
  }
  saveGroup(groupToSave) {
    if (this.groups.has(groupToSave.id)) {
      this.storedGroups.update(() => {
        return this.order.map((id) => this.groups.get(id)).map(storedGroup);
      });
    }
  }
  removeGroup(groupId) {
    if (this.groups.has(groupId)) {
      this.groups.delete(groupId);
      this.order.splice(this.order.indexOf(groupId), 1);
      this.storedGroups.update(() => {
        return this.order.map((id) => this.groups.get(id)).map(storedGroup);
      });
      return true;
    }
    return false;
  }
  setOrder(order) {
    this.order = [...order];
  }
  list() {
    return this.order.map((id) => this.groups.get(id));
  }
}
function storedGroup(group2) {
  return {
    color: group2.color,
    query: group2.query
  };
}
class TimelineFileItemGroup {
  constructor(id, files2, from) {
    __publicField(this, "_filter");
    __publicField(this, "_query");
    __publicField(this, "color");
    this.id = id;
    this.files = files2;
    this.color = from.color;
    this._query = from.query;
    this._filter = files2.parseFilter(from.query);
  }
  get query() {
    return this._query;
  }
  set query(query) {
    this._query = query;
    this._filter = this.files.parseFilter(query);
  }
  get filter() {
    return this._filter;
  }
}
const Row_svelte_svelte_type_style_lang = "";
function create_fragment$9(ctx) {
  let div;
  let div_class_value;
  let current;
  const default_slot_template = (
    /*#slots*/
    ctx[2].default
  );
  const default_slot = create_slot(
    default_slot_template,
    ctx,
    /*$$scope*/
    ctx[1],
    null
  );
  let div_levels = [
    /*$$restProps*/
    ctx[0],
    {
      class: div_class_value = "row" + /*$$restProps*/
      (ctx[0].class ? ` ${/*$$restProps*/
      ctx[0].class}` : "")
    }
  ];
  let div_data = {};
  for (let i = 0; i < div_levels.length; i += 1) {
    div_data = assign(div_data, div_levels[i]);
  }
  return {
    c() {
      div = element("div");
      if (default_slot)
        default_slot.c();
      set_attributes(div, div_data);
      toggle_class(div, "svelte-gabo5f", true);
    },
    m(target, anchor) {
      insert(target, div, anchor);
      if (default_slot) {
        default_slot.m(div, null);
      }
      current = true;
    },
    p(ctx2, [dirty]) {
      if (default_slot) {
        if (default_slot.p && (!current || dirty & /*$$scope*/
        2)) {
          update_slot_base(
            default_slot,
            default_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[1],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[1]
            ) : get_slot_changes(
              default_slot_template,
              /*$$scope*/
              ctx2[1],
              dirty,
              null
            ),
            null
          );
        }
      }
      set_attributes(div, div_data = get_spread_update(div_levels, [
        dirty & /*$$restProps*/
        1 && /*$$restProps*/
        ctx2[0],
        (!current || dirty & /*$$restProps*/
        1 && div_class_value !== (div_class_value = "row" + /*$$restProps*/
        (ctx2[0].class ? ` ${/*$$restProps*/
        ctx2[0].class}` : ""))) && { class: div_class_value }
      ]));
      toggle_class(div, "svelte-gabo5f", true);
    },
    i(local) {
      if (current)
        return;
      transition_in(default_slot, local);
      current = true;
    },
    o(local) {
      transition_out(default_slot, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(div);
      }
      if (default_slot)
        default_slot.d(detaching);
    }
  };
}
function instance$6($$self, $$props, $$invalidate) {
  const omit_props_names = [];
  let $$restProps = compute_rest_props($$props, omit_props_names);
  let { $$slots: slots = {}, $$scope } = $$props;
  $$self.$$set = ($$new_props) => {
    $$props = assign(assign({}, $$props), exclude_internal_props($$new_props));
    $$invalidate(0, $$restProps = compute_rest_props($$props, omit_props_names));
    if ("$$scope" in $$new_props)
      $$invalidate(1, $$scope = $$new_props.$$scope);
  };
  return [$$restProps, $$scope, slots];
}
class Row extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$6, create_fragment$9, safe_not_equal, {});
  }
}
const Select_svelte_svelte_type_style_lang = "";
const { Boolean: Boolean_1 } = globals;
function get_each_context(ctx, list, i) {
  const child_ctx = ctx.slice();
  child_ctx[18] = list[i];
  child_ctx[20] = i;
  return child_ctx;
}
const get_item_slot_changes = (dirty) => ({});
const get_item_slot_context = (ctx) => ({ index: (
  /*itemIndex*/
  ctx[20]
) });
const get_display_slot_changes = (dirty) => ({});
const get_display_slot_context = (ctx) => ({});
function create_if_block$1(ctx) {
  let dialog_1;
  let ul;
  let current;
  let each_value = ensure_array_like(new Array(
    /*itemCount*/
    ctx[0]
  ).fill(0));
  let each_blocks = [];
  for (let i = 0; i < each_value.length; i += 1) {
    each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
  }
  const out = (i) => transition_out(each_blocks[i], 1, 1, () => {
    each_blocks[i] = null;
  });
  return {
    c() {
      dialog_1 = element("dialog");
      ul = element("ul");
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].c();
      }
      attr(ul, "role", "listbox");
      attr(ul, "class", "svelte-1c1nzjf");
      dialog_1.open = /*open*/
      ctx[2];
      attr(dialog_1, "class", "select-dropdown svelte-1c1nzjf");
    },
    m(target, anchor) {
      insert(target, dialog_1, anchor);
      append(dialog_1, ul);
      for (let i = 0; i < each_blocks.length; i += 1) {
        if (each_blocks[i]) {
          each_blocks[i].m(ul, null);
        }
      }
      ctx[13](dialog_1);
      current = true;
    },
    p(ctx2, dirty) {
      if (dirty & /*$$scope, itemCount*/
      1025) {
        each_value = ensure_array_like(new Array(
          /*itemCount*/
          ctx2[0]
        ).fill(0));
        let i;
        for (i = 0; i < each_value.length; i += 1) {
          const child_ctx = get_each_context(ctx2, each_value, i);
          if (each_blocks[i]) {
            each_blocks[i].p(child_ctx, dirty);
            transition_in(each_blocks[i], 1);
          } else {
            each_blocks[i] = create_each_block(child_ctx);
            each_blocks[i].c();
            transition_in(each_blocks[i], 1);
            each_blocks[i].m(ul, null);
          }
        }
        group_outros();
        for (i = each_value.length; i < each_blocks.length; i += 1) {
          out(i);
        }
        check_outros();
      }
      if (!current || dirty & /*open*/
      4) {
        dialog_1.open = /*open*/
        ctx2[2];
      }
    },
    i(local) {
      if (current)
        return;
      for (let i = 0; i < each_value.length; i += 1) {
        transition_in(each_blocks[i]);
      }
      current = true;
    },
    o(local) {
      each_blocks = each_blocks.filter(Boolean_1);
      for (let i = 0; i < each_blocks.length; i += 1) {
        transition_out(each_blocks[i]);
      }
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(dialog_1);
      }
      destroy_each(each_blocks, detaching);
      ctx[13](null);
    }
  };
}
function create_each_block(ctx) {
  let current;
  const item_slot_template = (
    /*#slots*/
    ctx[11].item
  );
  const item_slot = create_slot(
    item_slot_template,
    ctx,
    /*$$scope*/
    ctx[10],
    get_item_slot_context
  );
  return {
    c() {
      if (item_slot)
        item_slot.c();
    },
    m(target, anchor) {
      if (item_slot) {
        item_slot.m(target, anchor);
      }
      current = true;
    },
    p(ctx2, dirty) {
      if (item_slot) {
        if (item_slot.p && (!current || dirty & /*$$scope*/
        1024)) {
          update_slot_base(
            item_slot,
            item_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[10],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[10]
            ) : get_slot_changes(
              item_slot_template,
              /*$$scope*/
              ctx2[10],
              dirty,
              get_item_slot_changes
            ),
            get_item_slot_context
          );
        }
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(item_slot, local);
      current = true;
    },
    o(local) {
      transition_out(item_slot, local);
      current = false;
    },
    d(detaching) {
      if (item_slot)
        item_slot.d(detaching);
    }
  };
}
function create_fragment$8(ctx) {
  let button_1;
  let button_1_disabled_value;
  let t;
  let if_block_anchor;
  let current;
  let mounted;
  let dispose;
  const display_slot_template = (
    /*#slots*/
    ctx[11].display
  );
  const display_slot = create_slot(
    display_slot_template,
    ctx,
    /*$$scope*/
    ctx[10],
    get_display_slot_context
  );
  let button_1_levels = [
    /*$$restProps*/
    ctx[7],
    { "aria-disabled": (
      /*disabled*/
      ctx[5]
    ) },
    {
      disabled: button_1_disabled_value = Boolean(
        /*disabled*/
        ctx[5]
      )
    },
    { role: "combobox" },
    { "aria-labelledby": "select button" },
    { "aria-haspopup": "listbox" },
    { "aria-expanded": (
      /*open*/
      ctx[2]
    ) },
    { "aria-controls": "select-dropdown" }
  ];
  let button_data = {};
  for (let i = 0; i < button_1_levels.length; i += 1) {
    button_data = assign(button_data, button_1_levels[i]);
  }
  let if_block = (
    /*open*/
    (ctx[2] || false) && create_if_block$1(ctx)
  );
  return {
    c() {
      button_1 = element("button");
      if (display_slot)
        display_slot.c();
      t = space();
      if (if_block)
        if_block.c();
      if_block_anchor = empty();
      set_attributes(button_1, button_data);
      toggle_class(button_1, "select", true);
    },
    m(target, anchor) {
      insert(target, button_1, anchor);
      if (display_slot) {
        display_slot.m(button_1, null);
      }
      if (button_1.autofocus)
        button_1.focus();
      ctx[12](button_1);
      insert(target, t, anchor);
      if (if_block)
        if_block.m(target, anchor);
      insert(target, if_block_anchor, anchor);
      current = true;
      if (!mounted) {
        dispose = [
          listen(
            button_1,
            "click",
            /*toggleShown*/
            ctx[1]
          ),
          listen(
            button_1,
            "focusout",
            /*onFocusOut*/
            ctx[6]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (display_slot) {
        if (display_slot.p && (!current || dirty & /*$$scope*/
        1024)) {
          update_slot_base(
            display_slot,
            display_slot_template,
            ctx2,
            /*$$scope*/
            ctx2[10],
            !current ? get_all_dirty_from_scope(
              /*$$scope*/
              ctx2[10]
            ) : get_slot_changes(
              display_slot_template,
              /*$$scope*/
              ctx2[10],
              dirty,
              get_display_slot_changes
            ),
            get_display_slot_context
          );
        }
      }
      set_attributes(button_1, button_data = get_spread_update(button_1_levels, [
        dirty & /*$$restProps*/
        128 && /*$$restProps*/
        ctx2[7],
        { "aria-disabled": (
          /*disabled*/
          ctx2[5]
        ) },
        { disabled: button_1_disabled_value },
        { role: "combobox" },
        { "aria-labelledby": "select button" },
        { "aria-haspopup": "listbox" },
        (!current || dirty & /*open*/
        4) && { "aria-expanded": (
          /*open*/
          ctx2[2]
        ) },
        { "aria-controls": "select-dropdown" }
      ]));
      toggle_class(button_1, "select", true);
      if (
        /*open*/
        ctx2[2] || false
      ) {
        if (if_block) {
          if_block.p(ctx2, dirty);
          if (dirty & /*open*/
          4) {
            transition_in(if_block, 1);
          }
        } else {
          if_block = create_if_block$1(ctx2);
          if_block.c();
          transition_in(if_block, 1);
          if_block.m(if_block_anchor.parentNode, if_block_anchor);
        }
      } else if (if_block) {
        group_outros();
        transition_out(if_block, 1, 1, () => {
          if_block = null;
        });
        check_outros();
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(display_slot, local);
      transition_in(if_block);
      current = true;
    },
    o(local) {
      transition_out(display_slot, local);
      transition_out(if_block);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(button_1);
        detach(t);
        detach(if_block_anchor);
      }
      if (display_slot)
        display_slot.d(detaching);
      ctx[12](null);
      if (if_block)
        if_block.d(detaching);
      mounted = false;
      run_all(dispose);
    }
  };
}
function descendsFrom(potentialDescendant, potentialAnscestor) {
  let node = potentialDescendant;
  while (node != null) {
    if (node == potentialAnscestor) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}
function instance$5($$self, $$props, $$invalidate) {
  const omit_props_names = ["itemCount", "show", "hide", "toggleShown"];
  let $$restProps = compute_rest_props($$props, omit_props_names);
  let { $$slots: slots = {}, $$scope } = $$props;
  const dispatch2 = createEventDispatcher();
  let { itemCount = 0 } = $$props;
  let { "aria-disabled": disabled } = $$restProps;
  let open = false;
  let button;
  let buttonBounds;
  function show(causedBy) {
    if (!disabled && !open && itemCount > 0 && dispatch2("showing", causedBy, { cancelable: true })) {
      if (button != null) {
        buttonBounds = button.getBoundingClientRect();
      }
      $$invalidate(2, open = true);
      dispatch2("shown", causedBy);
    }
  }
  function hide(causedBy) {
    if (!disabled && open && dispatch2("hiding", causedBy, { cancelable: true })) {
      $$invalidate(2, open = false);
      dispatch2("hidden", causedBy);
    }
  }
  function toggleShown(causedBy) {
    if (open) {
      hide(causedBy);
    } else {
      show(causedBy);
    }
  }
  let dialog;
  function positionDialog(dialog2) {
    if (dialog2.parentElement != document.body) {
      document.body.appendChild(dialog2);
    }
    const { width, height } = window.visualViewport;
    const dialogBounds = dialog2.getBoundingClientRect();
    if (buttonBounds != null) {
      dialog2.setCssStyles({
        left: `${Math.min(buttonBounds.x, width - dialogBounds.width)}px`,
        top: `${Math.min(buttonBounds.y + buttonBounds.height, height - dialogBounds.height)}px`,
        width: buttonBounds.width > dialogBounds.width ? `${buttonBounds.width}px` : void 0
      });
    } else {
      dialog2.setCssStyles({
        left: `${Math.max(0, (width - dialogBounds.width) / 2)}px`,
        top: `${Math.max(0, (height - dialogBounds.height) / 2)}px`
      });
    }
  }
  function onFocusOut(event) {
    if (dialog == null) {
      return;
    }
    const focusMovedTo = event.relatedTarget;
    if (focusMovedTo == null || !(focusMovedTo instanceof Node) || !descendsFrom(focusMovedTo, dialog)) {
      hide();
    } else {
      if (button != null) {
        button.focus();
      }
    }
  }
  function button_1_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      button = $$value;
      $$invalidate(4, button);
    });
  }
  function dialog_1_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      dialog = $$value;
      $$invalidate(3, dialog);
    });
  }
  $$self.$$set = ($$new_props) => {
    $$props = assign(assign({}, $$props), exclude_internal_props($$new_props));
    $$invalidate(7, $$restProps = compute_rest_props($$props, omit_props_names));
    if ("itemCount" in $$new_props)
      $$invalidate(0, itemCount = $$new_props.itemCount);
    if ("$$scope" in $$new_props)
      $$invalidate(10, $$scope = $$new_props.$$scope);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty & /*open*/
    4)
      ;
    if ($$self.$$.dirty & /*open, dialog*/
    12) {
      if (open && dialog != null)
        positionDialog(dialog);
    }
  };
  return [
    itemCount,
    toggleShown,
    open,
    dialog,
    button,
    disabled,
    onFocusOut,
    $$restProps,
    show,
    hide,
    $$scope,
    slots,
    button_1_binding,
    dialog_1_binding
  ];
}
class Select extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$5, create_fragment$8, safe_not_equal, {
      itemCount: 0,
      show: 8,
      hide: 9,
      toggleShown: 1
    });
  }
  get show() {
    return this.$$.ctx[8];
  }
  get hide() {
    return this.$$.ctx[9];
  }
  get toggleShown() {
    return this.$$.ctx[1];
  }
}
function create_fragment$7(ctx) {
  let svg;
  let circle;
  let polyline;
  return {
    c() {
      svg = svg_element("svg");
      circle = svg_element("circle");
      polyline = svg_element("polyline");
      attr(circle, "cx", "12");
      attr(circle, "cy", "12");
      attr(circle, "r", "10");
      attr(polyline, "points", "12 6 12 12 16 14");
      attr(svg, "xmlns", "http://www.w3.org/2000/svg");
      attr(svg, "width", "24");
      attr(svg, "height", "24");
      attr(svg, "viewBox", "0 0 24 24");
      attr(svg, "fill", "none");
      attr(svg, "stroke", "currentColor");
      attr(svg, "stroke-width", "2");
      attr(svg, "stroke-linecap", "round");
      attr(svg, "stroke-linejoin", "round");
      attr(svg, "class", "svg-icon lucide-clock");
    },
    m(target, anchor) {
      insert(target, svg, anchor);
      append(svg, circle);
      append(svg, polyline);
    },
    p: noop,
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(svg);
      }
    }
  };
}
class DateTimeIcon extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, null, create_fragment$7, safe_not_equal, {});
  }
}
function create_fragment$6(ctx) {
  let svg;
  let rect;
  let line0;
  let line1;
  let line2;
  return {
    c() {
      svg = svg_element("svg");
      rect = svg_element("rect");
      line0 = svg_element("line");
      line1 = svg_element("line");
      line2 = svg_element("line");
      attr(rect, "x", "3");
      attr(rect, "y", "4");
      attr(rect, "width", "18");
      attr(rect, "height", "18");
      attr(rect, "rx", "2");
      attr(rect, "ry", "2");
      attr(line0, "x1", "16");
      attr(line0, "y1", "2");
      attr(line0, "x2", "16");
      attr(line0, "y2", "6");
      attr(line1, "x1", "8");
      attr(line1, "y1", "2");
      attr(line1, "x2", "8");
      attr(line1, "y2", "6");
      attr(line2, "x1", "3");
      attr(line2, "y1", "10");
      attr(line2, "x2", "21");
      attr(line2, "y2", "10");
      attr(svg, "xmlns", "http://www.w3.org/2000/svg");
      attr(svg, "width", "24");
      attr(svg, "height", "24");
      attr(svg, "viewBox", "0 0 24 24");
      attr(svg, "fill", "none");
      attr(svg, "stroke", "currentColor");
      attr(svg, "stroke-width", "2");
      attr(svg, "stroke-linecap", "round");
      attr(svg, "stroke-linejoin", "round");
      attr(svg, "class", "svg-icon lucide-calendar");
    },
    m(target, anchor) {
      insert(target, svg, anchor);
      append(svg, rect);
      append(svg, line0);
      append(svg, line1);
      append(svg, line2);
    },
    p: noop,
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(svg);
      }
    }
  };
}
class DateIcon extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, null, create_fragment$6, safe_not_equal, {});
  }
}
function create_fragment$5(ctx) {
  let svg;
  let path0;
  let path1;
  let path2;
  let path3;
  let rect0;
  let rect1;
  return {
    c() {
      svg = svg_element("svg");
      path0 = svg_element("path");
      path1 = svg_element("path");
      path2 = svg_element("path");
      path3 = svg_element("path");
      rect0 = svg_element("rect");
      rect1 = svg_element("rect");
      attr(path0, "d", "M6 20h4");
      attr(path1, "d", "M14 10h4");
      attr(path2, "d", "M6 14h2v6");
      attr(path3, "d", "M14 4h2v6");
      attr(rect0, "x", "6");
      attr(rect0, "y", "4");
      attr(rect0, "width", "4");
      attr(rect0, "height", "6");
      attr(rect1, "x", "14");
      attr(rect1, "y", "14");
      attr(rect1, "width", "4");
      attr(rect1, "height", "6");
      attr(svg, "xmlns", "http://www.w3.org/2000/svg");
      attr(svg, "width", "24");
      attr(svg, "height", "24");
      attr(svg, "viewBox", "0 0 24 24");
      attr(svg, "fill", "none");
      attr(svg, "stroke", "currentColor");
      attr(svg, "stroke-width", "2");
      attr(svg, "stroke-linecap", "round");
      attr(svg, "stroke-linejoin", "round");
      attr(svg, "class", "svg-icon lucide-binary");
    },
    m(target, anchor) {
      insert(target, svg, anchor);
      append(svg, path0);
      append(svg, path1);
      append(svg, path2);
      append(svg, path3);
      append(svg, rect0);
      append(svg, rect1);
    },
    p: noop,
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(svg);
      }
    }
  };
}
class NumberIcon extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, null, create_fragment$5, safe_not_equal, {});
  }
}
function create_if_block_2(ctx) {
  let numbericon;
  let current;
  numbericon = new NumberIcon({});
  return {
    c() {
      create_component(numbericon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(numbericon, target, anchor);
      current = true;
    },
    i(local) {
      if (current)
        return;
      transition_in(numbericon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(numbericon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(numbericon, detaching);
    }
  };
}
function create_if_block_1(ctx) {
  let dateicon;
  let current;
  dateicon = new DateIcon({});
  return {
    c() {
      create_component(dateicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(dateicon, target, anchor);
      current = true;
    },
    i(local) {
      if (current)
        return;
      transition_in(dateicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(dateicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(dateicon, detaching);
    }
  };
}
function create_if_block(ctx) {
  let datetimeicon;
  let current;
  datetimeicon = new DateTimeIcon({});
  return {
    c() {
      create_component(datetimeicon.$$.fragment);
    },
    m(target, anchor) {
      mount_component(datetimeicon, target, anchor);
      current = true;
    },
    i(local) {
      if (current)
        return;
      transition_in(datetimeicon.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(datetimeicon.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(datetimeicon, detaching);
    }
  };
}
function create_fragment$4(ctx) {
  let div3;
  let div0;
  let span;
  let current_block_type_index;
  let if_block;
  let t0;
  let div2;
  let div1;
  let t1;
  let current;
  let mounted;
  let dispose;
  const if_block_creators = [create_if_block, create_if_block_1, create_if_block_2];
  const if_blocks = [];
  function select_block_type(ctx2, dirty) {
    if (
      /*type*/
      ctx2[3] === "datetime"
    )
      return 0;
    if (
      /*type*/
      ctx2[3] === "date"
    )
      return 1;
    if (
      /*type*/
      ctx2[3] === "number"
    )
      return 2;
    return -1;
  }
  if (~(current_block_type_index = select_block_type(ctx))) {
    if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  }
  return {
    c() {
      div3 = element("div");
      div0 = element("div");
      span = element("span");
      if (if_block)
        if_block.c();
      t0 = space();
      div2 = element("div");
      div1 = element("div");
      t1 = text(
        /*name*/
        ctx[2]
      );
      attr(span, "class", "suggestion-flair");
      attr(div0, "class", "suggestion-icon");
      attr(div1, "class", "suggestion-title");
      attr(div2, "class", "suggestion-content");
      attr(div3, "class", "suggestion-item mod-complex");
      attr(
        div3,
        "aria-selected",
        /*selected*/
        ctx[0]
      );
      attr(div3, "role", "option");
      attr(
        div3,
        "tabindex",
        /*index*/
        ctx[1]
      );
      toggle_class(
        div3,
        "is-selected",
        /*selected*/
        ctx[0]
      );
    },
    m(target, anchor) {
      insert(target, div3, anchor);
      append(div3, div0);
      append(div0, span);
      if (~current_block_type_index) {
        if_blocks[current_block_type_index].m(span, null);
      }
      append(div3, t0);
      append(div3, div2);
      append(div2, div1);
      append(div1, t1);
      current = true;
      if (!mounted) {
        dispose = [
          listen(
            div3,
            "mouseenter",
            /*mouseenter_handler*/
            ctx[5]
          ),
          listen(
            div3,
            "focusin",
            /*focusin_handler*/
            ctx[6]
          ),
          listen(
            div3,
            "click",
            /*click_handler*/
            ctx[7]
          ),
          listen(
            div3,
            "keydown",
            /*keydown_handler*/
            ctx[8]
          )
        ];
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      let previous_block_index = current_block_type_index;
      current_block_type_index = select_block_type(ctx2);
      if (current_block_type_index !== previous_block_index) {
        if (if_block) {
          group_outros();
          transition_out(if_blocks[previous_block_index], 1, 1, () => {
            if_blocks[previous_block_index] = null;
          });
          check_outros();
        }
        if (~current_block_type_index) {
          if_block = if_blocks[current_block_type_index];
          if (!if_block) {
            if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx2);
            if_block.c();
          }
          transition_in(if_block, 1);
          if_block.m(span, null);
        } else {
          if_block = null;
        }
      }
      if (!current || dirty & /*name*/
      4)
        set_data(
          t1,
          /*name*/
          ctx2[2]
        );
      if (!current || dirty & /*selected*/
      1) {
        attr(
          div3,
          "aria-selected",
          /*selected*/
          ctx2[0]
        );
      }
      if (!current || dirty & /*index*/
      2) {
        attr(
          div3,
          "tabindex",
          /*index*/
          ctx2[1]
        );
      }
      if (!current || dirty & /*selected*/
      1) {
        toggle_class(
          div3,
          "is-selected",
          /*selected*/
          ctx2[0]
        );
      }
    },
    i(local) {
      if (current)
        return;
      transition_in(if_block);
      current = true;
    },
    o(local) {
      transition_out(if_block);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(div3);
      }
      if (~current_block_type_index) {
        if_blocks[current_block_type_index].d();
      }
      mounted = false;
      run_all(dispose);
    }
  };
}
function instance$4($$self, $$props, $$invalidate) {
  const dispatch2 = createEventDispatcher();
  let { selected } = $$props;
  let { index } = $$props;
  let { name } = $$props;
  let { type } = $$props;
  const mouseenter_handler = () => dispatch2("consider", index);
  const focusin_handler = () => dispatch2("consider", index);
  const click_handler = () => dispatch2("select", index);
  const keydown_handler = (e) => e.key === "Enter" ? dispatch2("select", index) : null;
  $$self.$$set = ($$props2) => {
    if ("selected" in $$props2)
      $$invalidate(0, selected = $$props2.selected);
    if ("index" in $$props2)
      $$invalidate(1, index = $$props2.index);
    if ("name" in $$props2)
      $$invalidate(2, name = $$props2.name);
    if ("type" in $$props2)
      $$invalidate(3, type = $$props2.type);
  };
  return [
    selected,
    index,
    name,
    type,
    dispatch2,
    mouseenter_handler,
    focusin_handler,
    click_handler,
    keydown_handler
  ];
}
class PropertySelectionOption extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$4, create_fragment$4, safe_not_equal, { selected: 0, index: 1, name: 2, type: 3 });
  }
}
function create_display_slot(ctx) {
  let t;
  return {
    c() {
      t = text(
        /*selectedProperty*/
        ctx[0]
      );
    },
    m(target, anchor) {
      insert(target, t, anchor);
    },
    p(ctx2, dirty) {
      if (dirty & /*selectedProperty*/
      1)
        set_data(
          t,
          /*selectedProperty*/
          ctx2[0]
        );
    },
    d(detaching) {
      if (detaching) {
        detach(t);
      }
    }
  };
}
function create_item_slot(ctx) {
  let propertyselectionoption;
  let current;
  propertyselectionoption = new PropertySelectionOption({
    props: {
      slot: "item",
      index: (
        /*index*/
        ctx[10]
      ),
      selected: (
        /*selectedIndex*/
        ctx[3] === /*index*/
        ctx[10]
      ),
      name: (
        /*propertyNames*/
        ctx[1][
          /*index*/
          ctx[10]
        ]
      ),
      type: (
        /*typeOf*/
        ctx[7](
          /*index*/
          ctx[10]
        )
      )
    }
  });
  propertyselectionoption.$on(
    "select",
    /*select*/
    ctx[5]
  );
  propertyselectionoption.$on(
    "consider",
    /*consider*/
    ctx[6]
  );
  return {
    c() {
      create_component(propertyselectionoption.$$.fragment);
    },
    m(target, anchor) {
      mount_component(propertyselectionoption, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const propertyselectionoption_changes = {};
      if (dirty & /*index*/
      1024)
        propertyselectionoption_changes.index = /*index*/
        ctx2[10];
      if (dirty & /*selectedIndex, index*/
      1032)
        propertyselectionoption_changes.selected = /*selectedIndex*/
        ctx2[3] === /*index*/
        ctx2[10];
      if (dirty & /*propertyNames, index*/
      1026)
        propertyselectionoption_changes.name = /*propertyNames*/
        ctx2[1][
          /*index*/
          ctx2[10]
        ];
      if (dirty & /*index*/
      1024)
        propertyselectionoption_changes.type = /*typeOf*/
        ctx2[7](
          /*index*/
          ctx2[10]
        );
      propertyselectionoption.$set(propertyselectionoption_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(propertyselectionoption.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(propertyselectionoption.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(propertyselectionoption, detaching);
    }
  };
}
function create_fragment$3(ctx) {
  let select_1;
  let current;
  let select_1_props = {
    class: "dropdown",
    itemCount: (
      /*propertyCount*/
      ctx[4]
    ),
    $$slots: {
      item: [
        create_item_slot,
        ({ index }) => ({ 10: index }),
        ({ index }) => index ? 1024 : 0
      ],
      display: [create_display_slot]
    },
    $$scope: { ctx }
  };
  select_1 = new Select({ props: select_1_props });
  ctx[9](select_1);
  return {
    c() {
      create_component(select_1.$$.fragment);
    },
    m(target, anchor) {
      mount_component(select_1, target, anchor);
      current = true;
    },
    p(ctx2, [dirty]) {
      const select_1_changes = {};
      if (dirty & /*propertyCount*/
      16)
        select_1_changes.itemCount = /*propertyCount*/
        ctx2[4];
      if (dirty & /*$$scope, index, selectedIndex, propertyNames, selectedProperty*/
      3083) {
        select_1_changes.$$scope = { dirty, ctx: ctx2 };
      }
      select_1.$set(select_1_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(select_1.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(select_1.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      ctx[9](null);
      destroy_component(select_1, detaching);
    }
  };
}
function instance$3($$self, $$props, $$invalidate) {
  let propertyNames;
  let propertyCount;
  let selectedIndex;
  let { options } = $$props;
  let { selectedProperty } = $$props;
  let selectView;
  function select(event) {
    $$invalidate(0, selectedProperty = propertyNames[event.detail]);
    if (selectView != null) {
      selectView.hide(event);
    }
  }
  function consider(event) {
    $$invalidate(3, selectedIndex = event.detail);
  }
  function typeOf(index) {
    return options.typeOf(propertyNames[index]);
  }
  function select_1_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      selectView = $$value;
      $$invalidate(2, selectView);
    });
  }
  $$self.$$set = ($$props2) => {
    if ("options" in $$props2)
      $$invalidate(8, options = $$props2.options);
    if ("selectedProperty" in $$props2)
      $$invalidate(0, selectedProperty = $$props2.selectedProperty);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty & /*options*/
    256) {
      $$invalidate(1, propertyNames = options.names());
    }
    if ($$self.$$.dirty & /*propertyNames*/
    2) {
      $$invalidate(4, propertyCount = propertyNames.length);
    }
    if ($$self.$$.dirty & /*propertyNames, selectedProperty*/
    3) {
      $$invalidate(3, selectedIndex = propertyNames.indexOf(selectedProperty));
    }
  };
  return [
    selectedProperty,
    propertyNames,
    selectView,
    selectedIndex,
    propertyCount,
    select,
    consider,
    typeOf,
    options,
    select_1_binding
  ];
}
class PropertySelection extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$3, create_fragment$3, safe_not_equal, { options: 8, selectedProperty: 0 });
  }
}
const TIMELINE_PROPERTY_TYPES = Object.freeze([
  "number",
  "date",
  "datetime"
]);
function isTimelinePropertyType(type) {
  return TIMELINE_PROPERTY_TYPES.includes(type);
}
let timelineProperties;
function timelineFileProperties(properties2) {
  if (timelineProperties) {
    return timelineProperties;
  }
  const availableProperties = writable(
    filterByType(properties2.listKnownProperties(), TIMELINE_PROPERTY_TYPES).asMutable()
  );
  properties2.on("property-created", (name, type) => {
    if (isTimelinePropertyType(type)) {
      availableProperties.update((availableProperties2) => {
        availableProperties2.add(name, type);
        return availableProperties2;
      });
    }
  });
  properties2.on("property-type-changed", (name, type) => {
    availableProperties.update((availableProperties2) => {
      if (isTimelinePropertyType(type)) {
        availableProperties2.replace(name, type);
      } else {
        availableProperties2.remove(name);
      }
      return availableProperties2;
    });
  });
  properties2.on("property-removed", (name) => {
    availableProperties.update((availableProperties2) => {
      availableProperties2.remove(name);
      return availableProperties2;
    });
  });
  timelineProperties = availableProperties;
  return timelineProperties;
}
function create_default_slot_1(ctx) {
  let label;
  let t1;
  let propertyselection;
  let updating_selectedProperty;
  let current;
  function propertyselection_selectedProperty_binding(value) {
    ctx[8](value);
  }
  let propertyselection_props = { options: (
    /*$options*/
    ctx[1]
  ) };
  if (
    /*$property*/
    ctx[2] !== void 0
  ) {
    propertyselection_props.selectedProperty = /*$property*/
    ctx[2];
  }
  propertyselection = new PropertySelection({ props: propertyselection_props });
  binding_callbacks.push(() => bind(propertyselection, "selectedProperty", propertyselection_selectedProperty_binding));
  return {
    c() {
      label = element("label");
      label.textContent = "Name";
      t1 = space();
      create_component(propertyselection.$$.fragment);
      attr(label, "for", "orderPropertySelect");
    },
    m(target, anchor) {
      insert(target, label, anchor);
      insert(target, t1, anchor);
      mount_component(propertyselection, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const propertyselection_changes = {};
      if (dirty & /*$options*/
      2)
        propertyselection_changes.options = /*$options*/
        ctx2[1];
      if (!updating_selectedProperty && dirty & /*$property*/
      4) {
        updating_selectedProperty = true;
        propertyselection_changes.selectedProperty = /*$property*/
        ctx2[2];
        add_flush_callback(() => updating_selectedProperty = false);
      }
      propertyselection.$set(propertyselection_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(propertyselection.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(propertyselection.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(label);
        detach(t1);
      }
      destroy_component(propertyselection, detaching);
    }
  };
}
function create_default_slot$1(ctx) {
  let row;
  let current;
  row = new Row({
    props: {
      $$slots: { default: [create_default_slot_1] },
      $$scope: { ctx }
    }
  });
  return {
    c() {
      create_component(row.$$.fragment);
    },
    m(target, anchor) {
      mount_component(row, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const row_changes = {};
      if (dirty & /*$$scope, $options, $property*/
      1030) {
        row_changes.$$scope = { dirty, ctx: ctx2 };
      }
      row.$set(row_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(row.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(row.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(row, detaching);
    }
  };
}
function create_fragment$2(ctx) {
  let collapsablesection;
  let updating_collapsed;
  let current;
  function collapsablesection_collapsed_binding(value) {
    ctx[9](value);
  }
  let collapsablesection_props = {
    name: "Property",
    $$slots: { default: [create_default_slot$1] },
    $$scope: { ctx }
  };
  if (
    /*$collapsed*/
    ctx[0] !== void 0
  ) {
    collapsablesection_props.collapsed = /*$collapsed*/
    ctx[0];
  }
  collapsablesection = new CollapsableSection({ props: collapsablesection_props });
  binding_callbacks.push(() => bind(collapsablesection, "collapsed", collapsablesection_collapsed_binding));
  return {
    c() {
      create_component(collapsablesection.$$.fragment);
    },
    m(target, anchor) {
      mount_component(collapsablesection, target, anchor);
      current = true;
    },
    p(ctx2, [dirty]) {
      const collapsablesection_changes = {};
      if (dirty & /*$$scope, $options, $property*/
      1030) {
        collapsablesection_changes.$$scope = { dirty, ctx: ctx2 };
      }
      if (!updating_collapsed && dirty & /*$collapsed*/
      1) {
        updating_collapsed = true;
        collapsablesection_changes.collapsed = /*$collapsed*/
        ctx2[0];
        add_flush_callback(() => updating_collapsed = false);
      }
      collapsablesection.$set(collapsablesection_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(collapsablesection.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(collapsablesection.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(collapsablesection, detaching);
    }
  };
}
function instance$2($$self, $$props, $$invalidate) {
  let $collapsed;
  let $options;
  let $property;
  let { viewModel } = $$props;
  let { properties: properties2 } = $$props;
  const collapsed = viewModel.make("collapsed", true);
  component_subscribe($$self, collapsed, (value) => $$invalidate(0, $collapsed = value));
  const property = viewModel.make("property", "created");
  component_subscribe($$self, property, (value) => $$invalidate(2, $property = value));
  const options = timelineFileProperties(properties2);
  component_subscribe($$self, options, (value) => $$invalidate(1, $options = value));
  function propertyselection_selectedProperty_binding(value) {
    $property = value;
    property.set($property);
  }
  function collapsablesection_collapsed_binding(value) {
    $collapsed = value;
    collapsed.set($collapsed);
  }
  $$self.$$set = ($$props2) => {
    if ("viewModel" in $$props2)
      $$invalidate(6, viewModel = $$props2.viewModel);
    if ("properties" in $$props2)
      $$invalidate(7, properties2 = $$props2.properties);
  };
  return [
    $collapsed,
    $options,
    $property,
    collapsed,
    property,
    options,
    viewModel,
    properties2,
    propertyselection_selectedProperty_binding,
    collapsablesection_collapsed_binding
  ];
}
class TimelinePropertySetting extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$2, create_fragment$2, safe_not_equal, { viewModel: 6, properties: 7 });
  }
}
function create_default_slot(ctx) {
  let input;
  let mounted;
  let dispose;
  return {
    c() {
      input = element("input");
      attr(input, "type", "search");
      attr(input, "placeholder", "Search files...");
    },
    m(target, anchor) {
      insert(target, input, anchor);
      set_input_value(
        input,
        /*$query*/
        ctx[1]
      );
      if (!mounted) {
        dispose = listen(
          input,
          "input",
          /*input_input_handler*/
          ctx[5]
        );
        mounted = true;
      }
    },
    p(ctx2, dirty) {
      if (dirty & /*$query*/
      2 && input.value !== /*$query*/
      ctx2[1]) {
        set_input_value(
          input,
          /*$query*/
          ctx2[1]
        );
      }
    },
    d(detaching) {
      if (detaching) {
        detach(input);
      }
      mounted = false;
      dispose();
    }
  };
}
function create_fragment$1(ctx) {
  let collapsablesection;
  let updating_collapsed;
  let current;
  function collapsablesection_collapsed_binding(value) {
    ctx[6](value);
  }
  let collapsablesection_props = {
    name: "Filter",
    $$slots: { default: [create_default_slot] },
    $$scope: { ctx }
  };
  if (
    /*$collapsed*/
    ctx[0] !== void 0
  ) {
    collapsablesection_props.collapsed = /*$collapsed*/
    ctx[0];
  }
  collapsablesection = new CollapsableSection({ props: collapsablesection_props });
  binding_callbacks.push(() => bind(collapsablesection, "collapsed", collapsablesection_collapsed_binding));
  return {
    c() {
      create_component(collapsablesection.$$.fragment);
    },
    m(target, anchor) {
      mount_component(collapsablesection, target, anchor);
      current = true;
    },
    p(ctx2, [dirty]) {
      const collapsablesection_changes = {};
      if (dirty & /*$$scope, $query*/
      130) {
        collapsablesection_changes.$$scope = { dirty, ctx: ctx2 };
      }
      if (!updating_collapsed && dirty & /*$collapsed*/
      1) {
        updating_collapsed = true;
        collapsablesection_changes.collapsed = /*$collapsed*/
        ctx2[0];
        add_flush_callback(() => updating_collapsed = false);
      }
      collapsablesection.$set(collapsablesection_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(collapsablesection.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(collapsablesection.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      destroy_component(collapsablesection, detaching);
    }
  };
}
function instance$1($$self, $$props, $$invalidate) {
  let $collapsed;
  let $query;
  let { viewModel } = $$props;
  const collapsed = viewModel.make("collapsed", true);
  component_subscribe($$self, collapsed, (value) => $$invalidate(0, $collapsed = value));
  const query = viewModel.make("query", "");
  component_subscribe($$self, query, (value) => $$invalidate(1, $query = value));
  function input_input_handler() {
    $query = this.value;
    query.set($query);
  }
  function collapsablesection_collapsed_binding(value) {
    $collapsed = value;
    collapsed.set($collapsed);
  }
  $$self.$$set = ($$props2) => {
    if ("viewModel" in $$props2)
      $$invalidate(4, viewModel = $$props2.viewModel);
  };
  return [
    $collapsed,
    $query,
    collapsed,
    query,
    viewModel,
    input_input_handler,
    collapsablesection_collapsed_binding
  ];
}
class TimelineFilterSetting extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance$1, create_fragment$1, safe_not_equal, { viewModel: 4 });
  }
}
function getPropertyDisplayType(prop, availableProperties) {
  if (prop === void 0) {
    return "numeric";
  }
  if (prop.toLocaleLowerCase() === "created") {
    return "date";
  } else if (prop.toLocaleLowerCase() === "modified") {
    return "date";
  } else {
    const type = availableProperties.typeOf(prop);
    if (type === "date" || type === "datetime") {
      return "date";
    }
    return "numeric";
  }
}
const NoteTimeline_svelte_svelte_type_style_lang = "";
function create_additional_settings_slot(ctx) {
  let timelinepropertysetting;
  let t0;
  let timelinefiltersetting;
  let t1;
  let groups;
  let current;
  timelinepropertysetting = new TimelinePropertySetting({
    props: {
      viewModel: (
        /*settings*/
        ctx[7].namespace("property")
      ),
      properties: (
        /*obsidian*/
        ctx[1].vault().properties()
      )
    }
  });
  timelinefiltersetting = new TimelineFilterSetting({
    props: {
      viewModel: (
        /*settings*/
        ctx[7].namespace("filter")
      )
    }
  });
  let groups_props = {
    timelineItemGroups: (
      /*timelineItemGroups*/
      ctx[13]
    ),
    name: "Groups",
    viewModel: (
      /*groupsNamespace*/
      ctx[12]
    )
  };
  groups = new Groups({ props: groups_props });
  ctx[22](groups);
  return {
    c() {
      create_component(timelinepropertysetting.$$.fragment);
      t0 = space();
      create_component(timelinefiltersetting.$$.fragment);
      t1 = space();
      create_component(groups.$$.fragment);
    },
    m(target, anchor) {
      mount_component(timelinepropertysetting, target, anchor);
      insert(target, t0, anchor);
      mount_component(timelinefiltersetting, target, anchor);
      insert(target, t1, anchor);
      mount_component(groups, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const timelinepropertysetting_changes = {};
      if (dirty[0] & /*obsidian*/
      2)
        timelinepropertysetting_changes.properties = /*obsidian*/
        ctx2[1].vault().properties();
      timelinepropertysetting.$set(timelinepropertysetting_changes);
      const groups_changes = {};
      groups.$set(groups_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(timelinepropertysetting.$$.fragment, local);
      transition_in(timelinefiltersetting.$$.fragment, local);
      transition_in(groups.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(timelinepropertysetting.$$.fragment, local);
      transition_out(timelinefiltersetting.$$.fragment, local);
      transition_out(groups.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      if (detaching) {
        detach(t0);
        detach(t1);
      }
      destroy_component(timelinepropertysetting, detaching);
      destroy_component(timelinefiltersetting, detaching);
      ctx[22](null);
      destroy_component(groups, detaching);
    }
  };
}
function create_fragment(ctx) {
  let timelineview;
  let current;
  let timelineview_props = {
    items: (
      /*items*/
      ctx[2]
    ),
    namespacedWritable: (
      /*viewModel*/
      ctx[0]
    ),
    displayPropertyAs: getPropertyDisplayType(
      /*$orderProperty*/
      ctx[6],
      /*$availableProperties*/
      ctx[5]
    ),
    $$slots: {
      "additional-settings": [create_additional_settings_slot]
    },
    $$scope: { ctx }
  };
  timelineview = new Timeline({ props: timelineview_props });
  ctx[23](timelineview);
  timelineview.$on(
    "select",
    /*select_handler*/
    ctx[24]
  );
  return {
    c() {
      create_component(timelineview.$$.fragment);
    },
    m(target, anchor) {
      mount_component(timelineview, target, anchor);
      current = true;
    },
    p(ctx2, dirty) {
      const timelineview_changes = {};
      if (dirty[0] & /*items*/
      4)
        timelineview_changes.items = /*items*/
        ctx2[2];
      if (dirty[0] & /*viewModel*/
      1)
        timelineview_changes.namespacedWritable = /*viewModel*/
        ctx2[0];
      if (dirty[0] & /*$orderProperty, $availableProperties*/
      96)
        timelineview_changes.displayPropertyAs = getPropertyDisplayType(
          /*$orderProperty*/
          ctx2[6],
          /*$availableProperties*/
          ctx2[5]
        );
      if (dirty[0] & /*groupsView, obsidian*/
      10 | dirty[1] & /*$$scope*/
      16) {
        timelineview_changes.$$scope = { dirty, ctx: ctx2 };
      }
      timelineview.$set(timelineview_changes);
    },
    i(local) {
      if (current)
        return;
      transition_in(timelineview.$$.fragment, local);
      current = true;
    },
    o(local) {
      transition_out(timelineview.$$.fragment, local);
      current = false;
    },
    d(detaching) {
      ctx[23](null);
      destroy_component(timelineview, detaching);
    }
  };
}
function instance($$self, $$props, $$invalidate) {
  let $availableProperties;
  let $activeFilter;
  let $orderProperty;
  let $filterText;
  let { files: files2 } = $$props;
  let { propertySelection } = $$props;
  let { viewModel } = $$props;
  let { isNew = false } = $$props;
  let { obsidian: obsidian2 } = $$props;
  const settings = viewModel.namespace("settings");
  let orderProperty = viewModel.namespace("settings").namespace("property").make("property", "created");
  component_subscribe($$self, orderProperty, (value) => $$invalidate(6, $orderProperty = value));
  const availableProperties = timelineFileProperties(obsidian2.vault().properties());
  component_subscribe($$self, availableProperties, (value) => $$invalidate(5, $availableProperties = value));
  let filterSection = settings.namespace("filter");
  const filterText = filterSection.make("query", "");
  component_subscribe($$self, filterText, (value) => $$invalidate(30, $filterText = value));
  const activeFilter = writable(obsidian2.vault().files().parseFilter($filterText, MatchAllEmptyQuery));
  component_subscribe($$self, activeFilter, (value) => $$invalidate(29, $activeFilter = value));
  filterText.subscribe((newFilterText) => activeFilter.set(obsidian2.vault().files().parseFilter(newFilterText, MatchAllEmptyQuery)));
  let items = [];
  const groupsNamespace = settings.namespace("groups");
  const groupsRepo = new GroupRepository(groupsNamespace.make("groups", []), obsidian2.vault().files());
  let groupsView;
  let refreshTimeout;
  function scheduleRefresh() {
    if (refreshTimeout)
      return;
    refreshTimeout = setTimeout(
      () => {
        refreshTimeout = void 0;
        timelineView == null ? void 0 : timelineView.refresh();
      },
      250
    );
  }
  const timelineItemGroups = makeTimelineItemGroups(
    {
      groups: groupsRepo,
      items: {
        list() {
          return items;
        }
      },
      recolorProcess: void 0
    },
    {
      presentNewGroup(group2) {
        groupsView == null ? void 0 : groupsView.addGroup(group2);
      },
      presentReorderedGroups(groups) {
        groupsView == null ? void 0 : groupsView.newOrder(groups);
      },
      presentRecoloredGroup(group2) {
        groupsView == null ? void 0 : groupsView.recolorGroup(group2);
      },
      presentRecoloredItem(item) {
        scheduleRefresh();
      },
      presentRecoloredItems(items2) {
        scheduleRefresh();
      },
      presentRequeriedGroup(group2) {
        groupsView == null ? void 0 : groupsView.changeGroupQuery(group2);
      },
      hideGroup(groupId) {
        groupsView == null ? void 0 : groupsView.removeGroup(groupId);
      }
    }
  );
  function openFile(event, item) {
    var _a;
    const file = (_a = files2.get(item.id())) == null ? void 0 : _a.obsidianFile;
    if (file == null) {
      return;
    }
    if (event instanceof MouseEvent || event instanceof KeyboardEvent) {
      obsidian2.workspace().openFile(file, event);
    } else {
      obsidian2.workspace().openFileInNewTab(file);
    }
  }
  let timelineView;
  onMount(async () => {
    if (timelineView == null)
      return;
    $$invalidate(2, items = []);
    const groups = timelineItemGroups.listGroups();
    for (const item of files2.values()) {
      if (await item.obsidianFile.matches($activeFilter)) {
        const applicableGroup = await selectGroupForFile(groups, item.obsidianFile);
        item.applyGroup(applicableGroup);
        items.push(item);
      }
    }
    $$invalidate(2, items);
    let currentFilteringId = 0;
    activeFilter.subscribe(async (newFilter) => {
      const filteringId = currentFilteringId + 1;
      currentFilteringId = filteringId;
      const newItems = [];
      for (const item of Array.from(files2.values())) {
        if (currentFilteringId !== filteringId)
          break;
        if (await item.obsidianFile.matches(newFilter)) {
          newItems.push(item);
        }
      }
      $$invalidate(2, items = newItems);
    });
    if (isNew) {
      timelineView.zoomToFit(items);
    }
  });
  let previousOrderProperty = $orderProperty;
  onMount(() => {
    if (timelineView == null)
      return;
    orderProperty.subscribe((newOrderProperty) => {
      if (newOrderProperty != previousOrderProperty) {
        timelineView.zoomToFit(items);
        previousOrderProperty = newOrderProperty;
      }
    });
  });
  let groupUpdates = [];
  let itemUpdateTimeout;
  function scheduleItemUpdate() {
    if (itemUpdateTimeout != null)
      return;
    itemUpdateTimeout = setTimeout(
      async () => {
        itemUpdateTimeout = void 0;
        if (groupUpdates.length > 0) {
          const groups = groupsRepo.list();
          for (const item of groupUpdates) {
            const group2 = await selectGroupForFile(groups, item.obsidianFile);
            item.applyGroup(group2);
          }
          groupUpdates = [];
        }
        timelineView == null ? void 0 : timelineView.refresh();
      },
      250
    );
  }
  async function addFile(file) {
    if (timelineView == null)
      return;
    const item = new TimelineFileItem(file, propertySelection);
    files2.set(file.path(), item);
    file.matches($activeFilter).then((isApplicable) => {
      if (isApplicable) {
        items.push(item);
        scheduleItemUpdate();
      }
    });
  }
  function deleteFile(file) {
    if (timelineView == null)
      return;
    const item = files2.get(file.path());
    if (item == null)
      return;
    if (files2.delete(file.path())) {
      items.remove(item);
      scheduleItemUpdate();
    }
  }
  async function modifyFile(file) {
    if (timelineView == null)
      return;
    const item = files2.get(file.path());
    if (item == null)
      return;
    groupUpdates.push(item);
    scheduleItemUpdate();
  }
  async function renameFile(file, oldPath) {
    if (timelineView == null)
      return;
    const item = files2.get(oldPath);
    if (item == null)
      return;
    files2.delete(oldPath);
    files2.set(file.path(), item);
    groupUpdates.push(item);
    scheduleItemUpdate();
  }
  orderProperty.subscribe((newOrderProperty) => {
    $$invalidate(15, propertySelection.selector = getPropertySelector(newOrderProperty, $availableProperties), propertySelection);
    $$invalidate(2, items);
  });
  function groups_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      groupsView = $$value;
      $$invalidate(3, groupsView);
    });
  }
  function timelineview_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      timelineView = $$value;
      $$invalidate(4, timelineView);
    });
  }
  const select_handler = (e) => openFile(e.detail.causedBy, e.detail.item);
  $$self.$$set = ($$props2) => {
    if ("files" in $$props2)
      $$invalidate(16, files2 = $$props2.files);
    if ("propertySelection" in $$props2)
      $$invalidate(15, propertySelection = $$props2.propertySelection);
    if ("viewModel" in $$props2)
      $$invalidate(0, viewModel = $$props2.viewModel);
    if ("isNew" in $$props2)
      $$invalidate(17, isNew = $$props2.isNew);
    if ("obsidian" in $$props2)
      $$invalidate(1, obsidian2 = $$props2.obsidian);
  };
  return [
    viewModel,
    obsidian2,
    items,
    groupsView,
    timelineView,
    $availableProperties,
    $orderProperty,
    settings,
    orderProperty,
    availableProperties,
    filterText,
    activeFilter,
    groupsNamespace,
    timelineItemGroups,
    openFile,
    propertySelection,
    files2,
    isNew,
    addFile,
    deleteFile,
    modifyFile,
    renameFile,
    groups_binding,
    timelineview_binding,
    select_handler
  ];
}
class NoteTimeline extends SvelteComponent {
  constructor(options) {
    super();
    init(
      this,
      options,
      instance,
      create_fragment,
      safe_not_equal,
      {
        files: 16,
        propertySelection: 15,
        viewModel: 0,
        isNew: 17,
        obsidian: 1,
        addFile: 18,
        deleteFile: 19,
        modifyFile: 20,
        renameFile: 21
      },
      null,
      [-1, -1]
    );
  }
  get addFile() {
    return this.$$.ctx[18];
  }
  get deleteFile() {
    return this.$$.ctx[19];
  }
  get modifyFile() {
    return this.$$.ctx[20];
  }
  get renameFile() {
    return this.$$.ctx[21];
  }
}
const OBSIDIAN_LEAF_VIEW_TYPE = "VIEW_TYPE_TIMELINE_VIEW";
class TimelineTab {
  constructor(obsidian2) {
    __publicField(this, "_transientState", {});
    __publicField(this, "state");
    __publicField(this, "component");
    __publicField(this, "subscriptions");
    __publicField(this, "initialization");
    __publicField(this, "completeInitialization");
    __publicField(this, "stateSubscribers", []);
    this.obsidian = obsidian2;
    this.component = null;
    this.subscriptions = null;
    this.completeInitialization = () => {
    };
    this.initialization = new Promise((resolve) => {
      this.completeInitialization = resolve;
    });
    this.state = {};
  }
  get tabName() {
    var _a, _b, _c;
    if (((_c = (_b = (_a = this.state.settings) == null ? void 0 : _a.filter) == null ? void 0 : _b.query) != null ? _c : "") !== "") {
      return `Timeline view - ${this.state.settings.filter.query}`;
    }
    return "Timeline view";
  }
  onTabNameChange(run2) {
    let currentName = this.tabName;
    const listener = () => {
      const newName = this.tabName;
      if (newName !== currentName) {
        currentName = newName;
        run2(newName);
      }
    };
    this.stateSubscribers.push(listener);
    return () => this.stateSubscribers.remove(listener);
  }
  get transientState() {
    return this._transientState;
  }
  set transientState(state) {
    this._transientState = state;
  }
  getState() {
    this.stateSubscribers.forEach((listener) => listener());
    return this.state;
  }
  setState(state) {
    this.state = state;
    this.completeInitialization();
  }
  async render(header, content) {
    var _a;
    const container = content;
    container.createEl("progress");
    const propertySelection = {
      selector: NoPropertySelector,
      selectProperty(file) {
        return this.selector.selectProperty(file);
      }
    };
    const files2 = /* @__PURE__ */ new Map();
    for (const file of await this.obsidian.vault().files().list()) {
      files2.set(
        file.path(),
        new TimelineFileItem(file, propertySelection)
      );
    }
    (_a = this.initialization) == null ? void 0 : _a.then(() => {
      delete this.initialization;
      container.empty();
      container.setAttribute(
        "style",
        "padding:0;position: relative;overflow-x:hidden;"
      );
      this.component = new NoteTimeline({
        target: container,
        props: {
          files: files2,
          propertySelection,
          obsidian: this.obsidian,
          isNew: this._transientState.isNew,
          viewModel: writableProperties(
            this.state,
            (key, newValue) => {
              this.state[key] = newValue;
              this.obsidian.workspace().saveState();
            }
          )
        }
      });
      const fileRepo = this.obsidian.vault().files();
      this.subscriptions = [
        fileRepo.on("created", (file) => {
          var _a2;
          (_a2 = this.component) == null ? void 0 : _a2.addFile(file);
        }),
        fileRepo.on("deleted", (file) => {
          var _a2;
          (_a2 = this.component) == null ? void 0 : _a2.deleteFile(file);
        }),
        fileRepo.on("renamed", (file, oldFile) => {
          var _a2;
          (_a2 = this.component) == null ? void 0 : _a2.renameFile(file, oldFile);
        }),
        fileRepo.on("modified", (file) => {
          var _a2;
          (_a2 = this.component) == null ? void 0 : _a2.modifyFile(file);
        })
      ];
    });
  }
  onClose() {
    if (this.subscriptions != null) {
      this.subscriptions.forEach((unsubscribe) => unsubscribe());
    }
    if (this.component != null) {
      this.component.$destroy();
    }
  }
}
let creationCallback;
function registerTimelineTab(plugin, obsidian2) {
  plugin.registerView(OBSIDIAN_LEAF_VIEW_TYPE, (leaf) => {
    const tab = new TimelineTab(obsidian2);
    if (creationCallback) {
      creationCallback(tab);
    }
    return new TimelineLeafView(leaf, tab);
  });
}
function createTimelineTab(workspace, initialState) {
  creationCallback = (tab) => {
    creationCallback = void 0;
    tab.transientState = { isNew: true };
  };
  workspace.createNewLeaf(OBSIDIAN_LEAF_VIEW_TYPE, true, initialState);
}
class TimelineLeafView extends obsidian.ItemView {
  constructor(leaf, tab) {
    super(leaf);
    this.tab = tab;
    tab.onTabNameChange((newName) => {
      this.titleEl.setText(newName);
      leaf.updateHeader();
    });
  }
  getIcon() {
    return "waypoints";
  }
  getViewType() {
    return OBSIDIAN_LEAF_VIEW_TYPE;
  }
  getDisplayText() {
    return this.tab.tabName;
  }
  getEphemeralState() {
    return this.tab.transientState;
  }
  setEphemeralState(state) {
    this.tab.transientState = state;
    super.setEphemeralState(state);
  }
  getState() {
    return this.tab.getState();
  }
  setState(state, result) {
    this.tab.setState(state);
    return super.setState(state, result);
  }
  async onOpen() {
    const header = this.containerEl.children[0];
    const container = this.containerEl.children[1];
    await this.tab.render(header, container);
  }
  async onClose() {
    this.tab.onClose();
  }
}
async function presentNewTimelineLeaf(ctx, notes, propertySelector) {
  var _a, _b, _c, _d;
  const items = notes.map(
    (note) => new TimelineFileItem(note, propertySelector)
  );
  const minValue = (_b = (_a = items.at(0)) == null ? void 0 : _a.value()) != null ? _b : 0;
  const maxValue = (_d = (_c = items.at(-1)) == null ? void 0 : _c.value()) != null ? _d : 0;
  const range = maxValue - minValue;
  const focalValue = minValue + range / 2;
  createTimelineTab(ctx.workspace(), { focalValue });
}
class Workspace {
  constructor(app) {
    this.app = app;
  }
  async createNewLeaf(type, active2, state) {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type,
      active: active2,
      state
    });
    this.app.workspace.revealLeaf(leaf);
  }
  openFile(file, fromEvent) {
    file.openIn(this.app.workspace.getLeaf(obsidian.Keymap.isModEvent(fromEvent)));
  }
  openFileInNewTab(file) {
    file.openIn(this.app.workspace.getLeaf("tab"));
  }
  saveState() {
    this.app.workspace.requestSaveLayout();
  }
}
async function listNotesInOrder(ctx, property, output) {
  const propertySelector = getPropertySelector(
    property,
    ctx.properties().listKnownProperties()
  );
  const notes = (await ctx.files().list()).toSorted(
    (a, b) => propertySelector.selectProperty(a) - propertySelector.selectProperty(b)
  );
  output.presentOrderedNotes(notes, propertySelector);
}
function openTimelineView(ctx) {
  listNotesInOrder(ctx.vault(), "created", {
    presentOrderedNotes: presentNewTimelineLeaf.bind(null, ctx)
  });
}
class ObsidianTimelinePlugin extends obsidian.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "properties", properties(this.app.vault, this.app.metadataCache));
    __publicField(this, "files", files(this.app.vault, this.app.metadataCache));
    __publicField(this, "_workspace", new Workspace(this.app));
  }
  async onload() {
    registerTimelineTab(this, this);
    this.addRibbonIcon(
      "waypoints",
      "Open timeline view",
      () => openTimelineView(this)
    );
    this.addCommand({
      id: "open-timeline-view",
      name: "Open timeline view",
      callback: () => openTimelineView(this)
    });
    this.registerEvent(
      this.app.metadataCache.on(
        "changed",
        this.properties.metadataChanged.bind(this.properties)
      )
    );
    this.registerEvent(
      this.app.metadataCache.on(
        "changed",
        this.files.fileModified.bind(this.files)
      )
    );
    this.registerEvent(
      this.app.vault.on(
        "create",
        this.files.fileCreated.bind(this.files)
      )
    );
    this.registerEvent(
      this.app.vault.on(
        "rename",
        this.files.fileRenamed.bind(this.files)
      )
    );
    this.registerEvent(
      this.app.vault.on(
        "modify",
        this.files.fileModified.bind(this.files)
      )
    );
    this.registerEvent(
      this.app.vault.on(
        "delete",
        this.files.fileDeleted.bind(this.files)
      )
    );
  }
  vault() {
    return {
      properties: () => this.properties,
      files: () => this.files
    };
  }
  workspace() {
    return this._workspace;
  }
}
module.exports = ObsidianTimelinePlugin;
