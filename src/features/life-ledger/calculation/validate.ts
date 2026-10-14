import type {
  CalculationField,
  CalculationIssue,
  LifePlanInput,
  ValidationResult,
} from './types';

const numericFields: Array<[CalculationField, number]> = [
  ['baseYear', 0],
  ['currentAge', 0],
  ['retirementAge', 0],
  ['endAge', 0],
  ['monthlyIncome', 0],
  ['monthlyWorkingExpenses', 0],
  ['monthlyRetirementSelfFunded', 0],
  ['currentSavings', 0],
];

function issue(
  code: CalculationIssue['code'],
  field: CalculationField,
  message: string
): CalculationIssue {
  return { code, field, message };
}

export function validateLifePlanInput(input: LifePlanInput): ValidationResult {
  const issues: CalculationIssue[] = [];
  const values = new Map<CalculationField, number>(numericFields);

  if (input.mode !== 'have' && input.mode !== 'need') {
    issues.push(
      issue('OUT_OF_RANGE', 'mode', 'Calculation mode must be have or need.')
    );
  }

  values.set('baseYear', input.baseYear);
  values.set('currentAge', input.currentAge);
  values.set('retirementAge', input.retirementAge);
  values.set('endAge', input.endAge);
  values.set('monthlyIncome', input.monthlyIncome);
  values.set('monthlyWorkingExpenses', input.monthlyWorkingExpenses);
  values.set('monthlyRetirementSelfFunded', input.monthlyRetirementSelfFunded);
  values.set('currentSavings', input.currentSavings);

  const rates: Array<[CalculationField, number]> = [
    ['assumptions.realSavingsRate', input.assumptions.realSavingsRate],
    ['assumptions.realBorrowingRate', input.assumptions.realBorrowingRate],
    [
      'assumptions.annualIncomeGrowthRate',
      input.assumptions.annualIncomeGrowthRate,
    ],
    [
      'assumptions.annualWorkingExpenseGrowthRate',
      input.assumptions.annualWorkingExpenseGrowthRate,
    ],
    [
      'assumptions.annualRetirementExpenseGrowthRate',
      input.assumptions.annualRetirementExpenseGrowthRate,
    ],
  ];

  for (const [field, value] of [...values, ...rates]) {
    if (!Number.isFinite(value)) {
      issues.push(issue('NOT_FINITE', field, 'Value must be a finite number.'));
    }
  }

  if (
    !Number.isInteger(input.baseYear) ||
    input.baseYear < 1900 ||
    input.baseYear > 2200
  ) {
    issues.push(
      issue(
        'OUT_OF_RANGE',
        'baseYear',
        'Base year must be between 1900 and 2200.'
      )
    );
  }

  if (
    !Number.isInteger(input.currentAge) ||
    input.currentAge < 18 ||
    input.currentAge > 99
  ) {
    issues.push(
      issue(
        'OUT_OF_RANGE',
        'currentAge',
        'Current age must be between 18 and 99.'
      )
    );
  }

  if (
    !Number.isInteger(input.retirementAge) ||
    !Number.isInteger(input.endAge)
  ) {
    issues.push(
      issue(
        'OUT_OF_RANGE',
        'retirementAge',
        'Planning ages must be whole years.'
      )
    );
  }

  if (
    input.retirementAge <= input.currentAge ||
    input.endAge <= input.retirementAge ||
    input.endAge > 120
  ) {
    issues.push(
      issue(
        'INVALID_AGE_ORDER',
        'retirementAge',
        'Retirement must follow current age and the plan must end after retirement.'
      )
    );
  }

  for (const [field, value] of values) {
    if (
      field !== 'baseYear' &&
      field !== 'currentAge' &&
      field !== 'retirementAge' &&
      field !== 'endAge' &&
      value < 0
    ) {
      issues.push(
        issue('NEGATIVE_AMOUNT', field, 'Amounts cannot be negative.')
      );
    }
  }

  for (const [field, value] of rates) {
    if (value <= -1 || value > 1) {
      issues.push(
        issue(
          'INVALID_RATE',
          field,
          'Annual rates must be greater than -100% and at most 100%.'
        )
      );
    }
  }

  return { valid: issues.length === 0, issues };
}
