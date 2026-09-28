// Content Hub type registry and GraphQL document builders for the content
// MCP server. Field names, query names, and variable types are verified
// against the erxes-global-profile GraphQL schema (lib/graphql/schema/
// contenthub.ts, changelogs.ts and users.ts).
// Pure module — imported by tools.ts and by the schema-validation test.

export const CONTENT_TYPES = [
  "doc",
  "blog",
  "guide",
  "handbook",
  "roadmap",
  "changelog",
] as const;

export type TContentType = (typeof CONTENT_TYPES)[number];

export type TTypeConfig = {
  listQuery: string;
  getQuery: string;
  categoriesQuery: string | null;
  createMutation: string;
  updateMutation: string;
  /** Writable fields on top of title/content/isPublished. */
  extraFields: string[];
  /** Extra GraphQL selection on detail/mutation results. */
  extraSelection: string;
  /** Supports the categoryId/isComingSoon fields and a categories query. */
  supportsCategory: boolean;
  /** Extra mutation variable declarations (incl. GraphQL types). */
  mutationParams: string[];
};

const CATEGORIES_SELECTION = "_id title code parentId";

const RELATION_MUTATION_PARAMS = ["$productId: String", "$pluginId: String"];

export const TYPE_CONFIG: Record<TContentType, TTypeConfig> = {
  doc: {
    listQuery: "documentsMainList",
    getQuery: "document",
    categoriesQuery: "documentCategories",
    createMutation: "createDoc",
    updateMutation: "updateDoc",
    extraFields: ["productId", "pluginId"],
    extraSelection: "productId pluginId",
    supportsCategory: true,
    mutationParams: RELATION_MUTATION_PARAMS,
  },
  blog: {
    listQuery: "blogsMainList",
    getQuery: "blog",
    categoriesQuery: "blogCategories",
    createMutation: "createBlog",
    updateMutation: "updateBlog",
    extraFields: ["slug", "description", "mainPicture"],
    extraSelection: "slug description mainPicture",
    supportsCategory: true,
    mutationParams: [
      "$mainPicture: String",
      "$description: String",
      "$slug: String",
    ],
  },
  guide: {
    listQuery: "guidesMainList",
    getQuery: "guide",
    categoriesQuery: "guideCategories",
    createMutation: "createGuide",
    updateMutation: "updateGuide",
    extraFields: ["productId", "pluginId"],
    extraSelection: "productId pluginId",
    supportsCategory: true,
    mutationParams: RELATION_MUTATION_PARAMS,
  },
  handbook: {
    listQuery: "handbooksMainList",
    getQuery: "handbook",
    categoriesQuery: "handbookCategories",
    createMutation: "createHandbook",
    updateMutation: "updateHandbook",
    extraFields: ["productId", "pluginId"],
    extraSelection: "productId pluginId",
    supportsCategory: true,
    mutationParams: RELATION_MUTATION_PARAMS,
  },
  roadmap: {
    listQuery: "roadmapsMainList",
    getQuery: "roadmap",
    categoriesQuery: "roadmapCategories",
    createMutation: "createRoadmap",
    updateMutation: "updateRoadmap",
    extraFields: ["date"],
    extraSelection: "date",
    supportsCategory: true,
    mutationParams: ["$date: Date"],
  },
  changelog: {
    listQuery: "changelogMainList",
    getQuery: "changelog",
    categoriesQuery: null,
    createMutation: "createChangelog",
    updateMutation: "updateChangelog",
    // `changelogType` is the accepted input name; it is sent as `type`.
    extraFields: [
      "subtitle",
      "date",
      "changelogType",
      "type",
      "pluginId",
      "productId",
    ],
    extraSelection: "subtitle date type pluginId productId",
    supportsCategory: false,
    mutationParams: [
      "$subtitle: String",
      "$date: String",
      "$type: String",
      "$pluginId: String",
      "$productId: String",
    ],
  },
};

const COMMON_MUTABLE_FIELDS = ["title", "content", "isPublished"];
const CATEGORY_MUTABLE_FIELDS = ["isComingSoon", "categoryId"];

export const allowedFields = (type: TContentType): string[] => [
  ...COMMON_MUTABLE_FIELDS,
  ...(TYPE_CONFIG[type].supportsCategory ? CATEGORY_MUTABLE_FIELDS : []),
  ...TYPE_CONFIG[type].extraFields,
];

/**
 * Validates input fields against the chosen content type and builds the
 * GraphQL variables object. Omitted (undefined/null) keys are not sent so
 * partial updates leave other fields untouched.
 */
export const buildVariables = (
  type: TContentType,
  fields: Record<string, any>
): Record<string, any> => {
  const allowed = new Set(allowedFields(type));
  const variables: Record<string, any> = {};

  for (const [key, rawValue] of Object.entries(fields)) {
    if (
      rawValue === undefined ||
      rawValue === null ||
      key === "contentFormat"
    ) {
      continue;
    }

    if (!allowed.has(key)) {
      throw new Error(
        `Field "${key}" is not supported for type "${type}". ` +
          `Supported fields: ${allowedFields(type).join(", ")}.`
      );
    }

    const gqlKey = key === "changelogType" ? "type" : key;
    variables[gqlKey] =
      rawValue instanceof Date ? rawValue.toISOString() : rawValue;
  }

  return variables;
};

const MAIN_LIST_SELECTION = (type: TContentType) =>
  type === "changelog"
    ? "_id title isPublished modifiedAt"
    : "_id title isPublished slug categoryId modifiedAt";

const DETAIL_SELECTION = (type: TContentType) => {
  const cfg = TYPE_CONFIG[type];

  // ChangeLog.createdBy/publishedBy/modifiedBy are User objects.
  if (type === "changelog") {
    return `_id title content isPublished createdAt publishedAt modifiedAt
      createdBy { _id email } publishedBy { _id email } modifiedBy { _id email }
      ${cfg.extraSelection}`;
  }

  return `_id title content isPublished isComingSoon slug categoryId
    createdAt publishedAt modifiedAt createdBy publishedBy modifiedBy
    ${cfg.extraSelection}`;
};

export const LIST_QUERY = (type: TContentType) => {
  const cfg = TYPE_CONFIG[type];
  const categoryParam = cfg.supportsCategory ? ", $categoryId: String" : "";
  const categoryParamDef = cfg.supportsCategory
    ? ", categoryId: $categoryId"
    : "";

  return `query ContentList($searchValue: String, $page: Int, $perPage: Int, $isPublished: Boolean${categoryParam}) {
  ${cfg.listQuery}(searchValue: $searchValue, page: $page, perPage: $perPage, isPublished: $isPublished${categoryParamDef}) {
    total
    list { ${MAIN_LIST_SELECTION(type)} }
  }
}`;
};

export const GET_QUERY = (type: TContentType) => {
  const cfg = TYPE_CONFIG[type];
  const slugParam = type === "blog" ? ", $slug: String" : "";
  const slugParamDef = type === "blog" ? ", slug: $slug" : "";

  return `query ContentGet($_id: String${slugParam}) {
  ${cfg.getQuery}(_id: $_id${slugParamDef}) { ${DETAIL_SELECTION(type)} }
}`;
};

const MUTATION_SELECTION = (type: TContentType) =>
  type === "blog" ? "_id title isPublished slug" : "_id title isPublished";

export const WRITE_MUTATION = (
  type: TContentType,
  action: "create" | "update"
) => {
  const cfg = TYPE_CONFIG[type];
  const params = [
    ...(action === "update" ? ["$_id: String"] : []),
    "$content: String",
    "$title: String",
    "$isPublished: Boolean",
    ...(cfg.supportsCategory
      ? ["$isComingSoon: Boolean", "$categoryId: String"]
      : []),
    ...cfg.mutationParams,
  ];
  const paramsDef = params
    .map(p => {
      const name = p.split(":")[0].trim();
      return `${name.slice(1)}: ${name}`;
    })
    .join(", ");
  const mutation =
    action === "create" ? cfg.createMutation : cfg.updateMutation;

  return `mutation Content${action === "create" ? "Create" : "Update"}(${params.join(", ")}) {
  ${mutation}(${paramsDef}) { ${MUTATION_SELECTION(type)} }
}`;
};

export const CATEGORIES_QUERY = (type: TContentType) => {
  const cfg = TYPE_CONFIG[type];
  return `query ContentCategories($searchValue: String) {
  ${cfg.categoriesQuery}(searchValue: $searchValue) { ${CATEGORIES_SELECTION} }
}`;
};

export const USER_DETAIL_QUERY = `query CurrentUser {
  userDetail { _id email role name firstName lastName }
}`;
