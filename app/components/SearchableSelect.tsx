'use client';
import {useId} from 'react';
import {Combobox,ComboboxInput,ComboboxContent,ComboboxList,ComboboxItem,ComboboxEmpty} from '../../components/ui/combobox';
export type SelectOption={value:string,label:string,disabled?:boolean};
export default function SearchableSelect({label,value,options,onChange,disabled=false,required=false,order,hint}:{label:string,value:string,options:SelectOption[],onChange:(value:string)=>void,disabled?:boolean,required?:boolean,order?:number,hint?:string}){
 const id=useId(),hintId=id+'-hint',selected=options.find(x=>x.value===value)||null;
 return <div className="reference-select-field" style={order===undefined?undefined:{order}}><label htmlFor={id}><span>{label}{required&&<span className="required-mark" aria-hidden="true"> *</span>}</span></label><Combobox items={options} value={selected} onValueChange={(option:SelectOption|null)=>onChange(option?.value||'')} itemToStringLabel={(option:SelectOption)=>option.label} itemToStringValue={(option:SelectOption)=>option.value} isItemEqualToValue={(a:SelectOption,b:SelectOption)=>a.value===b.value} disabled={disabled}>
  <ComboboxInput className="reference-select-control" id={id} disabled={disabled} aria-label={label} aria-required={required||undefined} aria-describedby={hint?hintId:undefined} placeholder="ابحث ثم اختر…" showClear={!disabled}/><ComboboxContent className="aircraft-reference-popup" dir="rtl"><ComboboxEmpty>لا توجد نتائج مطابقة</ComboboxEmpty><ComboboxList>{(option:SelectOption)=><ComboboxItem key={option.value} value={option} disabled={option.disabled}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
 </Combobox>{hint&&<small id={hintId} className="hint">{hint}</small>}</div>;
}
