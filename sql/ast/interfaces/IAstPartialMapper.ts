import * as a from './ISqlNode';
import INil from './INil';

export default interface IAstPartialMapper {
  statement?: (val: a.IStatement) => a.IStatement | INil;
  update?: (val: a.IUpdateStatement) => a.IStatement | INil
  insert?: (val: a.IInsertStatement) => a.IStatement | INil
  delete?: (val: a.IDeleteStatement) => a.IStatement | INil
  comment?: (val: a.ICommentStatement) => a.IStatement | INil
  set?: (st: a.ISetStatement) => a.ISetStatement | INil
  dataType?: (dataType: a.IDataTypeDef) => a.IDataTypeDef
  parameter?: (st: a.IExprParameter) => a.IExpr | INil
  tableRef?: (st: a.IQNameAliased) => a.IQNameAliased | INil
  select?: (val: a.ISelectStatement) => a.ISelectStatement | INil
  selection?: (val: a.ISelectFromStatement) => a.ISelectStatement | INil
  from?: (from: a.IFrom) => a.IFrom | INil
  fromCall?: (from: a.IFromCall) => a.IFrom | INil
  fromStatement?: (from: a.IFromStatement) => a.IFrom | INil
  values?: (from: a.IValuesStatement) => a.ISelectStatement | INil;
  fromTable?: (from: a.FromTable) => a.IFrom | INil
  selectionColumn?: (val: a.ISelectedColumn) => a.ISelectedColumn | INil
  expr?: (val: a.IExpr) => a.IExpr | INil
  ternary?: (val: a.IExprTernary) => a.IExpr | INil
  arraySelect?: (val: a.IExprArrayFromSelect) => a.IExpr | INil
  arrayIndex?: (val: a.IExprArrayIndex) => a.IExpr | INil
  member?: (val: a.IExprMember) => a.IExpr | INil
  extract?: (st: a.IExprExtract) => a.IExpr | INil
  case?: (val: a.IExprCase) => a.IExpr | INil
  cast?: (val: a.IExprCast) => a.IExpr | INil
  call?: (val: a.IExprCall) => a.IExpr | INil
  callSubstring?: (val: a.IExprSubstring) => a.IExpr | INil
  callOverlay?: (val: a.IExprOverlay) => a.IExpr | INil
  array?: (val: a.IExprList) => a.IExpr | INil
  constant?: (value: a.IExprLiteral) => a.IExpr | INil
  default?: (value: a.IExprDefault) => a.IExpr | INil;
  ref?: (val: a.IExprRef) => a.IExpr | INil
  unary?: (val: a.IExprUnary) => a.IExpr | INil
  binary?: (val: a.IExprBinary) => a.IExpr | INil
  join?(join: a.IJoinClause): a.IJoinClause | INil
  valueKeyword?(val: a.IExprValueKeyword): a.IExpr | INil
}