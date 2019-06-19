export interface ConseilServerInfo {
    url: string;
    apiKey: string;
}
export declare enum ConseilSortDirection {
    ASC = "asc",
    DESC = "desc"
}
export declare enum ConseilOperator {
    BETWEEN = "between",
    EQ = "eq",
    IN = "in",
    LIKE = "like",
    LT = "lt",
    BEFORE = "before",
    GT = "gt",
    AFTER = "after",
    STARTSWITH = "startsWith",
    ENDSWITH = "endsWith",
    ISNULL = "isnull"
}
export declare enum ConseilFunction {
    avg = "avg",
    count = "count",
    max = "max",
    min = "min",
    sum = "sum"
}
export declare enum ConseilOutput {
    csv = "csv",
    json = "json"
}
export interface ConseilOrdering {
    field: string;
    direction: ConseilSortDirection;
}
export interface ConseilPredicate {
    field: string;
    operation: ConseilOperator;
    set: any[];
    inverse: boolean;
}
export interface ConseilQuery {
    fields: string[];
    predicates: ConseilPredicate[];
    orderBy: ConseilOrdering[];
    limit: number;
    aggregations?: ConseilAggregation[];
    output?: string;
}
export interface ConseilAggregation {
    field: string;
    function: ConseilFunction;
}
