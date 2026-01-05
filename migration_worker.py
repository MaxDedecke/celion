import os
import pika
import time
import json
import psycopg
import psycopg.rows
from typing import Any, Callable, Dict

# ----------------------------------------------------------------------------
# Database Utilities
# ----------------------------------------------------------------------------

def _get_db_connection() -> psycopg.Connection:
    """Create a new PostgreSQL connection using environment variables."""
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "celion"),
        user=os.environ.get("POSTGRES_USER", "celion"),
        password=os.environ.get("POSTGRES_PASSWORD", "celion"),
        row_factory=psycopg.rows.dict_row,
    )

def _write_chat_message(conn: psycopg.Connection, migration_id: str, role: str, content: str, step_number: int | None = None):
    """Writes a message to the migration_chat_messages table."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.migration_chat_messages (migration_id, role, content, step_number)
            VALUES (%s, %s, %s, %s)
            """,
            (migration_id, role, content, step_number),
        )
        conn.commit()

def _update_migration_step_status(conn: psycopg.Connection, migration_id: str, step_number: int, status: str, message: str | None = None):
    """Updates the status of a migration and its current step."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.migrations
            SET current_step = %s, step_status = %s
            WHERE id = %s
            """,
            (step_number, status, migration_id),
        )
        conn.commit()

# ----------------------------------------------------------------------------
# Agent Step Functions (Mocks)
# ----------------------------------------------------------------------------

def run_step_1_system_detection(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting System Detection...', 1)
    print(f"[{migration_id}] Running step 1: System Detection")
    time.sleep(2) # Simulate LLM call, curl, etc.
    result_message = "System detected: Jira Cloud. Curl Response: 200 OK"
    _write_chat_message(conn, migration_id, 'assistant', result_message, 1)

def run_step_2_auth_flow(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Authentication Flow...', 2)
    print(f"[{migration_id}] Running step 2: Authentication Flow")
    time.sleep(2)
    result_message = "Authentication successful. Received API token."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 2)

def run_step_3_capability_discovery(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Capability Discovery...', 3)
    print(f"[{migration_id}] Running step 3: Capability Discovery")
    time.sleep(2)
    result_message = "Discovered capabilities: issue tracking, project management."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 3)

def run_step_4_schema_generation(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Schema Generation...', 4)
    print(f"[{migration_id}] Running step 4: Schema Generation")
    time.sleep(2)
    result_message = "Schema generated for source and target systems."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 4)

def run_step_5_mapping_generation(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Mapping Generation...', 5)
    print(f"[{migration_id}] Running step 5: Mapping Generation")
    time.sleep(2)
    result_message = "Field and value mappings generated."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 5)

def run_step_6_data_fetching(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Data Fetching...', 6)
    print(f"[{migration_id}] Running step 6: Data Fetching")
    time.sleep(2)
    result_message = "Fetched 100 issues from source system."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 6)

def run_step_7_data_transformation(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Data Transformation...', 7)
    print(f"[{migration_id}] Running step 7: Data Transformation")
    time.sleep(2)
    result_message = "Transformed 100 issues for target system."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 7)

def run_step_8_data_loading(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Data Loading...', 8)
    print(f"[{migration_id}] Running step 8: Data Loading")
    time.sleep(2)
    result_message = "Loaded 100 issues into target system."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 8)

def run_step_9_validation(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Validation...', 9)
    print(f"[{migration_id}] Running step 9: Validation")
    time.sleep(2)
    result_message = "Data validation successful. All items match."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 9)

def run_step_10_cleanup(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Cleanup...', 10)
    print(f"[{migration_id}] Running step 10: Cleanup")
    time.sleep(2)
    result_message = "Cleanup complete. Migration finished. [Download Report](/reports/migration_report_123.pdf)"
    _write_chat_message(conn, migration_id, 'assistant', result_message, 10)


# ----------------------------------------------------------------------------
# Worker & Dispatcher
# ----------------------------------------------------------------------------

STEP_DISPATCHER: Dict[int, Callable] = {
    1: run_step_1_system_detection,
    2: run_step_2_auth_flow,
    3: run_step_3_capability_discovery,
    4: run_step_4_schema_generation,
    5: run_step_5_mapping_generation,
    6: run_step_6_data_fetching,
    7: run_step_7_data_transformation,
    8: run_step_8_data_loading,
    9: run_step_9_validation,
    10: run_step_10_cleanup,
}

def process_migration_step(job_payload: Dict[str, Any]):
    """Main processing function for a single migration step."""
    migration_id = job_payload.get("migrationId")
    step_number = job_payload.get("stepNumber")

    if not migration_id or not step_number:
        print(f" [!] Invalid job payload, missing migrationId or stepNumber: {job_payload}")
        return

    step_function = STEP_DISPATCHER.get(step_number)
    if not step_function:
        print(f" [!] No handler for step {step_number} in migration {migration_id}")
        return
        
    db_conn = None
    try:
        db_conn = _get_db_connection()
        _update_migration_step_status(db_conn, migration_id, step_number, 'running')
        
        step_function(db_conn, migration_id, job_payload)
        
        next_step = step_number + 1 if step_number < 10 else step_number
        _update_migration_step_status(db_conn, migration_id, next_step, 'completed')

        print(f" [{migration_id}] Step {step_number} completed successfully.")

    except Exception as e:
        print(f" [!] Error processing step {step_number} for migration {migration_id}: {e}")
        if db_conn:
            _update_migration_step_status(db_conn, migration_id, step_number, 'failed', str(e))
            _write_chat_message(db_conn, migration_id, 'system', f"Error during step {step_number}: {e}", step_number)
    finally:
        if db_conn:
            db_conn.close()


def get_rabbitmq_connection():
    """Establishes a connection to RabbitMQ, retrying if necessary."""
    rabbitmq_host = os.getenv("RABBITMQ_HOST", "localhost")
    rabbitmq_user = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
    rabbitmq_pass = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
    credentials = pika.PlainCredentials(rabbitmq_user, rabbitmq_pass)
    connection_attempts = 10
    for i in range(connection_attempts):
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host, credentials=credentials))
            print("Successfully connected to RabbitMQ.")
            return connection
        except pika.exceptions.AMQPConnectionError as e:
            print(f"Failed to connect to RabbitMQ (attempt {i+1}/{connection_attempts}): {e}")
            if i < connection_attempts - 1:
                time.sleep(5)
            else:
                raise

def callback(ch, method, properties, body):
    """Callback function to process messages from the queue."""
    print(f" [x] Received message: {body.decode()}")
    
    try:
        job_payload = json.loads(body)
        process_migration_step(job_payload)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        print(f" [!] Error processing message: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

def main():
    """Main function to start the worker."""
    print("Starting migration worker...")
    connection = get_rabbitmq_connection()
    channel = connection.channel()

    queue_name = 'migration_tasks'
    channel.queue_declare(queue=queue_name, durable=True)

    print(f" [*] Waiting for messages in queue '{queue_name}'. To exit press CTRL+C")
    
    channel.basic_consume(queue=queue_name, on_message_callback=callback)

    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print("Stopping consumer.")
        channel.stop_consuming()
    finally:
        connection.close()
        print("RabbitMQ connection closed.")

if __name__ == '__main__':
    main()