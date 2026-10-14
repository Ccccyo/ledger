import { addMonths, basisPoints, createQuickLifePlan, monthIndex, yuan, type LifePlan } from '../domain';
import { saveCareerChange, updateSalaryGrowth } from '../workspace/plan/career-mutations';
import { saveStageEvent } from '../workspace/plan/event-mutations';

export const PERSONA_INPUTS=[
 {id:'lin',age:24,cash:3,income:8000,expense:5000,retirement:4000},
 {id:'chen',age:30,cash:20,income:18000,expense:9000,retirement:7000},
 {id:'zhou',age:32,cash:30,income:20000,expense:10000,retirement:8000},
 {id:'xu',age:36,cash:50,income:30000,expense:12000,retirement:9000},
 {id:'zhao',age:57,cash:80,income:16000,expense:8000,retirement:7000},
 {id:'tang',age:40,cash:10,income:15000,expense:10000,retirement:6000},
] as const;

export function personaPlans() {
 return PERSONA_INPUTS.map((p)=>{
  const baseline=createQuickLifePlan({id:`persona-${p.id}`,name:`Synthetic persona: ${p.id}`,baseMonth:monthIndex(2026,10),currentAge:p.age,retirementAge:60,endAge:90,currentSavingsYuan:p.cash*10000,monthlyIncomeYuan:p.income,monthlyWorkingExpensesYuan:p.expense,monthlyRetirementSelfFundedYuan:p.retirement,now:'2026-10-14T00:00:00.000Z'});
  let plan:LifePlan=baseline;
  const event=(stage:'partner'|'child'|'housing'|'parents',id:string,amount:number,start:number,end:number,direction:'income'|'expense'='expense',frequency:'monthly'|'once'='monthly')=>{
    plan=saveStageEvent(plan,stage,{id,name:id,amountYuan:amount,start:addMonths(plan.baseMonth,start),end:addMonths(plan.baseMonth,end),frequency,direction});
  };
  if(p.id==='chen'){
    plan=updateSalaryGrowth(plan,3);
    plan=saveCareerChange(plan,{id:'new-job',kind:'salary',amount:25000,start:addMonths(plan.baseMonth,24),end:plan.retirementMonth,name:'New job',annualGrowthPercent:2});
    plan=saveCareerChange(plan,{id:'side',kind:'side_income',amount:3000,start:plan.baseMonth,end:addMonths(plan.baseMonth,60),name:'Side income'});
  }
  if(p.id==='zhou'){event('partner','contribution',2000,0,336,'income');event('partner','extra-cost',3000,0,336);event('child','child-care',4000,24,240);}
  if(p.id==='xu'){event('housing','housing-payment',800000,24,25,'expense','once');event('child','child-care',5000,24,240);}
  if(p.id==='zhao')event('parents','parent-support',3000,0,96);
  if(p.id==='tang'){
    plan=updateSalaryGrowth(plan,-1);
    plan=saveCareerChange(plan,{id:'side',kind:'side_income',amount:2000,start:plan.baseMonth,end:plan.retirementMonth,name:'Side income'});
    plan=saveCareerChange(plan,{id:'break',kind:'break',amount:0,start:addMonths(plan.baseMonth,12),end:addMonths(plan.baseMonth,18),name:'Break'});
  }
  return {id:p.id,baseline,plan};
 });
}
export function propertyPersona() {
 const plan=personaPlans().find((p)=>p.id==='xu')!.plan;
 return {...plan,assets:[...plan.assets,{id:'home',name:'Existing home',ownerId:plan.primaryMemberId,kind:'property' as const,openingBalanceCents:yuan(2000000),liquid:false,annualReturnBps:basisPoints(0),source:{kind:'user' as const,label:'Synthetic imported property'},confirmation:'confirmed' as const}],liabilities:[{id:'mortgage',name:'Existing mortgage',ownerId:plan.primaryMemberId,kind:'mortgage' as const,openingPrincipalCents:yuan(1000000),annualInterestBps:basisPoints(300),monthlyPaymentCents:yuan(7000),startMonth:plan.baseMonth,endMonthExclusive:plan.retirementMonth,source:{kind:'user' as const,label:'Synthetic imported debt'},confirmation:'confirmed' as const}]};
}
