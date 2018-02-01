const env = require('dotenv').config()
const Knex = require('knex')

const connection = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    typeCast: function (field, next) {
        if (field.type == 'TINY' && field.length == 1) {
            return (field.string() == '1'); // 1 = true, 0 = false
        } else if (field.type == 'BIT' && field.length == 1) {
            return (field.string() == "\u0001"); // 1 = true, 0 = false
        }
        return next();
    }
}

const knex = Knex({client: 'mysql', connection: connection});

const createLogTable = async ()=>{
const r= await knex.raw(`CREATE TABLE db_log (
    id int(11) unsigned NOT NULL,
    user varchar(200) DEFAULT NULL,
    up_sql text,
    down_sql text,
    mod_table varchar(64) DEFAULT NULL,
    create_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (Id)
  ) ENGINE=InnoDB DEFAULT CHARSET=latin1`)
  return r;
}

const add_trigger_insert = async (table,fields)=>{
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_log_after_insert;
    DELIMITER $$
    CREATE TRIGGER ${table}_log_after_insert                 -- trigger name
    AFTER INSERT ON ${table}                             -- table being triggered after insert queries
    FOR EACH ROW
    BEGIN
     INSERT INTO db_log                                   -- table that records the changes
       ( up_sql, down_sql, mod_table, user ) 
     VALUES
       (
       CONCAT(
         "INSERT INTO ${table} (${fields.map((f)=>`${f},`)}) VALUES (",
         ${fields.map((f)=>`CAST( NEW.${f} AS CHAR ), ",",`)}
         ")" 
       ),                                                                                         -- modifying operation
       CONCAT( "DELETE FROM ${table} WHERE id=", CAST( NEW.id AS CHAR ) ), -- undo operation
       "${table}",                                                                             -- table affected
       user()                                                                                     -- modifier user
       );
    END $$
    DELIMITER ;`);
}
const add_trigger_update = async (table,fields)=>{
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_log_after_update;
    DELIMITER $$
    CREATE TRIGGER ${table}_log_after_update                 -- trigger name
    AFTER UPDATE  ON ${table}                             -- table being triggered after insert queries
    FOR EACH ROW
    BEGIN
     INSERT INTO db_log                                   -- table that records the changes
       ( up_sql, down_sql, mod_table, user ) 
     VALUES
     (
        CONCAT( 
          "UPDATE ${table} SET ",
          if( NEW.intfield1 = OLD.intfield1, "", CONCAT( "intfield1=", CAST( NEW.intfield1 AS CHAR ), "," ) ),
          if( NEW.charfield2 = OLD.charfield2, "", CONCAT( "charfield2=", "'", CAST( NEW.charfield2 AS CHAR ), "'," ) ),
          if( NEW.charfield3 = OLD.charfield3, "", CONCAT( "charfield3=", "'", CAST( NEW.charfield3 AS CHAR ), "'," ) ),
          CONCAT( "primaryfield=", CAST( NEW.primaryfield AS CHAR ) ),
        " WHERE ", "primaryfield=", CAST( NEW.primaryfield AS CHAR )
        ),
        CONCAT(
          "UPDATE ${table} SET ",
          if( NEW.intfield1 = OLD.intfield1, "", CONCAT( "intfield1=", CAST( OLD.intfield1 AS CHAR ), "," ) ),
          if( NEW.charfield2 = OLD.charfield2, "", CONCAT( "charfield2=", "'", CAST( OLD.charfield2 AS CHAR ), "'," ) ),
          if( NEW.charfield3 = OLD.charfield3, "", CONCAT( "charfield3=", "'", CAST( OLD.charfield3 AS CHAR ), "'," ) ),
          CONCAT( "primaryfield=", CAST( OLD.primaryfield AS CHAR ) ),
        " WHERE ", "primaryfield=", CAST( OLD.primaryfield AS CHAR )
        ),
        "${table}",
        user()
        );
     END $$
     DELIMITER ;`);
}
const add_trigger_delete = async (table,fields)=>{
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_after_delete;
    DELIMITER $$
    CREATE TRIGGER ${table}_after_delete
    AFTER DELETE ON ${table}
    FOR EACH ROW
    BEGIN
     INSERT INTO db_log 
     ( up_sql, down_sql, mod_table, user ) 
     VALUES 
       ( 
       CONCAT( "DELETE FROM ${table} WHERE primaryfield=", CAST( OLD.primaryfield AS CHAR ) ),
       CONCAT(
       "INSERT INTO ${table} (primaryfield, intfield1, charfield2, charfield3) VALUES (", 
          CAST( OLD.primaryfield AS CHAR ), ",",
          CAST( OLD.intfield1 AS CHAR ), ",",
          "'", OLD.charfield2, "'", ",",
          "'", OLD.charfield3, "'",
          ")" 
       ),
     "${table}",
     user() 
     );
    END $$
    DELIMITER ;`);
}

const addTriggers = async ()=>{
    const raw_tables = await knex.raw(`SELECT tables.TABLE_NAME
    FROM INFORMATION_SCHEMA.tables as tables
    where tables.TABLE_SCHEMA = '${process.env.DB_NAME}'
    order by tables.TABLE_NAME;`);

    const tables = raw_tables[0].map((t) => {
        return t.TABLE_NAME
    })

    for (let i = 0; i < tables.length; i++) {
       let fields = await getFields(tables[i]);
        await add_trigger_insert(tables[i],fields);
        await add_trigger_update(tables[i],fields);
        await add_trigger_delete(tables[i],fields);
    }
}

const main = async ()=>{
    await createLogTable();
    await addTriggers();
    return 'finished!'
}

main().then(()=>console.log('operation complete!'));