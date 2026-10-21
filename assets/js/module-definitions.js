// Field definitions for agricultural record screens. Matching HTML is kept in each role folder.
window.CacaoModules = {
  harvests:{table:'harvests',title:'Harvest & production',date:'harvest_date',mutable:true,fields:[
    ['plantation_id','Plantation','plantation',true],['harvest_date','Harvest date','date',true],['variety','Cacao variety','variety',true],
    ['harvested_pods','Harvested pods','integer',true],['wet_bean_kg','Wet beans (kg)','decimal',true],['dry_bean_kg','Dry beans (kg)','decimal',true],
    ['estimated_value_php','Estimated value (PHP)','money',true],['remarks','Remarks','textarea']
  ],columns:['plantation','harvest_date','harvested_pods','wet_bean_kg','dry_bean_kg','dry_kg_per_ha','estimated_value_php']},
  pests:{table:'pest_reports',title:'Pest & disease reports',date:'observed_on',mutable:true,fields:[
    ['plantation_id','Plantation','plantation',true],['observed_on','Date observed','date',true],['pest_name','Pest / disease name','text',true],
    ['severity','Severity','select',true,['low','moderate','high','critical']],['affected_trees','Estimated affected trees','integer',true],
    ['resolution_status','Resolution status','select',true,['open','monitoring','resolved']],['evidence','Photographic evidence (up to 5 MB)','file'],['remarks','Observations','textarea']
  ],columns:['plantation','observed_on','pest_name','severity','affected_trees','resolution_status']},
  treatments:{table:'pest_treatments',title:'Treatment history',date:'treatment_date',fields:[
    ['plantation_id','Plantation','plantation',true],['pest_report_id','Pest / disease report','pest',true],['treatment_date','Treatment date','date',true],
    ['treatment','Treatment performed','textarea',true],['next_inspection','Next inspection date','date'],['remarks','Remarks','textarea']
  ],columns:['plantation','pest','treatment_date','treatment','next_inspection']},
  inspections:{table:'pest_inspections',title:'Follow-up inspections',date:'inspected_on',fields:[
    ['plantation_id','Plantation','plantation',true],['pest_report_id','Pest / disease report','pest',true],['inspected_on','Inspection date','date',true],
    ['findings','Inspection findings','textarea',true],['resolution_status','Resolution status','select',true,['open','monitoring','resolved']],
    ['severity','Observed severity','select',true,['low','moderate','high','critical']]
  ],columns:['plantation','pest','inspected_on','severity','resolution_status','findings']},
  tasks:{table:'plantation_tasks',title:'Plantation task schedule',date:'scheduled_on',mutable:true,fields:[
    ['plantation_id','Plantation','plantation',true],['title','Task title','text',true],
    ['task_type','Task type','select',true,['pruning','fertilizer','irrigation','weeding','harvesting','other']],['scheduled_on','Scheduled date','date',true],
    ['worker_id','Assigned worker (optional)','worker'],['status','Task status','select',true,['planned','in_progress','completed','cancelled']],
    ['completed_on','Completion date','date'],['remarks','Instructions / remarks','textarea']
  ],columns:['plantation','title','task_type','scheduled_on','worker','status','completed_on']},
  maintenance:{table:'maintenance_records',title:'Farm maintenance history',date:'performed_on',fields:[
    ['plantation_id','Plantation','plantation',true],['performed_on','Performed on','date',true],
    ['activity_type','Activity','select',true,['pruning','fertilizer','irrigation','weeding','other']],['product','Fertilizer / material (optional)','text'],
    ['quantity','Quantity (optional)','decimal'],['unit','Unit (e.g. kg, liters, trees)','text'],['remarks','Work performed','textarea']
  ],columns:['plantation','performed_on','activity_type','product','quantity','unit','remarks']},
  attendance:{table:'worker_attendance',title:'Daily worker attendance',date:'attendance_date',mutable:true,staffOnly:true,fields:[
    ['plantation_id','Plantation','plantation',true],['worker_id','Worker','worker',true],['attendance_date','Attendance date','date',true],
    ['status','Attendance','select',true,['present','absent','half_day']],['hours','Hours worked','hours',true],['remarks','Remarks','textarea']
  ],columns:['plantation','worker','attendance_date','status','hours','remarks']},
  'tree-events':{table:'tree_events',title:'Planting, mortality & replacement',date:'event_date',fields:[
    ['plantation_id','Plantation','plantation',true],['event_date','Event date','date',true],['event_type','Event','select',true,['planting','mortality','replacement']],
    ['quantity','Number of trees','positive',true],['variety','Cacao variety','variety',true],['age_months','Tree age at event (months, optional)','integer'],['remarks','Remarks / cause','textarea']
  ],columns:['plantation','event_date','event_type','quantity','variety','age_months','remarks']},
  'tree-tags':{table:'cacao_trees',title:'Individual cacao tree tags',date:'planted_on',mutable:true,fields:[
    ['plantation_id','Plantation','plantation',true],['tag_code','Tree tag','text',true],['variety','Cacao variety','variety',true],
    ['condition','Tree condition','select',true,['seedling','productive','unproductive','damaged','dead']],['planted_on','Date planted','date'],
    ['latitude','Latitude (optional)','latitude'],['longitude','Longitude (optional)','longitude'],['notes','Notes','textarea']
  ],columns:['plantation','tag_code','variety','condition','planted_on','tree_age_months','latitude','longitude']}
};
